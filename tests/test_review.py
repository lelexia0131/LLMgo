import asyncio
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
from agents.tool_context import ToolContext

from backend.agent.tools import TeachingContext, create_tools
from backend.domain.analysis import CandidateMove, PositionAnalysis
from backend.services.game_service import GameService
from backend.services.review_service import ReviewService


def evaluation(player, moves, score=3, winrate=.7):
    return PositionAnalysis(score_lead=score, winrate=winrate, visits=100,
                            perspective=player, candidates=[
        CandidateMove(coordinate=move, score_lead=value, winrate=.7 - index * .1,
                      visits=50, prior=.2, pv=[move], order=index)
        for index, (move, value) in enumerate(moves)])


@pytest.mark.parametrize('player,sgf', [('B', b'(;SZ[9];B[dd])'),
                                      ('W', b'(;SZ[9]PL[W];W[dd])')])
def test_review_uses_parent_and_normalizes_after_to_actual_player(player, sgf):
    async def check():
        game = GameService()
        game.open(sgf, None)
        game.navigate('last')
        snapshot = game.review_snapshot()
        opponent = 'W' if player == 'B' else 'B'
        before = evaluation(player, [('E5', 3), ('D6', 1)])
        after = evaluation(opponent, [], score=-1, winrate=.4)
        analysis = SimpleNamespace(analyze_position=AsyncMock(side_effect=[before, after]),
                                   analyze_move=AsyncMock())
        review = await ReviewService(analysis).inspect_move(snapshot)
        assert review.player == player and review.actual_move == 'D6'
        assert review.before.score_lead == 3 and review.after.score_lead == 1
        assert review.after.winrate == pytest.approx(.6)
        assert review.score_loss == 2 and review.winrate_loss == pytest.approx(.1)
        assert review.actual_move_status == 'top_candidate'
        assert review.actual_move_rank == 2
        assert review.parent_node_id == '0'
        assert analysis.analyze_position.await_args_list[0].args[0].move_number == 0
        assert analysis.analyze_position.await_args_list[1].args[0].node_id == snapshot.current.node_id
        analysis.analyze_move.assert_not_awaited()
    asyncio.run(check())


def test_outside_candidate_is_forced_without_invented_rank():
    async def check():
        game = GameService()
        game.open(b'(;SZ[9];B[])', None)
        game.navigate('last')
        before = evaluation('B', [('E5', 3)])
        forced = evaluation('B', [('pass', -2)])
        analysis = SimpleNamespace(analyze_position=AsyncMock(side_effect=[before, evaluation('W', [])]),
                                   analyze_move=AsyncMock(return_value=forced))
        review = await ReviewService(analysis).inspect_move(game.review_snapshot())
        assert review.actual_move == 'pass' and review.actual_move_rank is None
        assert review.actual_move_status == 'outside_returned_candidates'
        assert review.actual_move_analysis.pv == ['pass']
        assert review.score_loss == 5
        assert len(review.candidate_moves) == 1
        assert analysis.analyze_move.await_args.args[1] == 'pass'
    asyncio.run(check())


def test_snapshot_keeps_branch_ids_and_survives_live_edit():
    async def check():
        game = GameService()
        game.open(b'(;SZ[9];B[dd](;W[ee])(;W[ff]))', None)
        game.navigate('node', '3')
        game.play('A1', game.revision)
        snapshot = game.review_snapshot()
        target = snapshot.current.node_id
        game.edit('deleteBranch', game.revision)
        analysis = SimpleNamespace(analyze_position=AsyncMock(side_effect=[
            evaluation('B', [('A1', 3)]), evaluation('W', [])]))
        review = await ReviewService(analysis).inspect_move(snapshot)
        assert review.node_id == target and review.parent_node_id == '3'
        assert review.move_number == 3 and review.actual_move_status == 'best'
        assert target not in game.adapter.entries
    asyncio.run(check())


def test_inspect_move_tool_returns_evidence_for_unmarked_actual_move():
    async def check():
        game = GameService()
        game.open(b'(;SZ[9];B[dd])', None)
        game.navigate('last')
        analysis = SimpleNamespace(analyze_position=AsyncMock(side_effect=[
            evaluation('B', [('D6', 3)]), evaluation('W', [])]))
        ctx = TeachingContext(game=game.context(), analysis=analysis, snapshot=game.review_snapshot())
        tool = next(tool for tool in create_tools(ctx) if tool.name == 'inspect_move')
        wrapper = ToolContext(context=None, tool_name=tool.name, tool_call_id='test', tool_arguments='{"node_id":null}')
        result = await tool.on_invoke_tool(wrapper, wrapper.tool_arguments)
        assert result['actual_move'] == 'D6' and result['source'] == 'KataGo'
        assert result['evidence_id'] and result['node_id'] == ctx.game.node_id
        assert ctx.evidence_count == 1 and not ctx.game.markers
    asyncio.run(check())


@pytest.mark.parametrize('orders,expected_rank', [([0, 1, 2, 3], 4), ([0, 1, 2, 10], None),
                                                 ([None, None, None, None], None)])
def test_searched_candidate_rank_requires_complete_engine_order(orders, expected_rank):
    async def check():
        game = GameService()
        game.open(b'(;SZ[9];B[dd])', None)
        game.navigate('last')
        before = evaluation('B', [('E5', 3), ('C3', 2), ('A1', 1), ('D6', 0)])
        for candidate, order in zip(before.candidates, orders):
            candidate.order = order
        analysis = SimpleNamespace(analyze_position=AsyncMock(side_effect=[before, evaluation('W', [])]))
        review = await ReviewService(analysis).inspect_move(game.review_snapshot())
        assert review.actual_move_status == 'searched_candidate'
        assert review.actual_move_rank == expected_rank
    asyncio.run(check())


def test_review_preserves_setup_and_explicit_player():
    async def check():
        game = GameService()
        game.open(b'(;SZ[9];B[dd];AB[aa]PL[W];W[ee])', None)
        game.navigate('last')
        analysis = SimpleNamespace(analyze_position=AsyncMock(side_effect=[
            evaluation('W', [('E5', 3)]), evaluation('B', [])]))
        review = await ReviewService(analysis).inspect_move(game.review_snapshot())
        parent = analysis.analyze_position.await_args_list[0].args[0]
        assert parent.to_play == 'W' and parent.move_history == []
        assert {move.coordinate for move in parent.initial_stones} == {'A9', 'D6'}
        assert review.move_number == 2 and review.parent_node_id == '2'
    asyncio.run(check())


def test_review_rejects_non_move_nodes():
    async def check():
        game = GameService()
        service = ReviewService(SimpleNamespace())
        with pytest.raises(ValueError, match='实战落子'):
            await service.inspect_move(game.review_snapshot())
    asyncio.run(check())
