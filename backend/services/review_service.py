from backend.domain.analysis import PositionAnalysis
from backend.domain.context import GameContext, GameSnapshot
from backend.domain.move import Color
from backend.domain.review import Evaluation, MoveReview, PositionReview
from backend.services.analysis_service import AnalysisService
from backend.sgf.adapter import SGFAdapter


def evaluation(result: PositionAnalysis, player: Color) -> Evaluation:
    same = result.perspective == player
    return Evaluation(score_lead=result.score_lead if same else -result.score_lead,
                      winrate=result.winrate if same else 1 - result.winrate, visits=result.visits)


class ReviewService:
    def __init__(self, analysis: AnalysisService) -> None:
        self.analysis = analysis

    async def inspect_position(self, context: GameContext) -> PositionReview:
        result = await self.analysis.analyze_position(context)
        return PositionReview(game_id=context.game_id, node_id=context.node_id, revision=context.revision,
                              move_number=context.move_number, to_play=context.to_play,
                              root_evaluation=evaluation(result, context.to_play), candidate_moves=result.candidates)

    async def inspect_move(self, snapshot: GameSnapshot, node_id: str | None = None) -> MoveReview:
        # Rehydrate the question's SGF, including setup nodes and stable branch IDs.
        adapter = SGFAdapter(snapshot.sgf_data)
        adapter.ids = dict(zip(adapter.refs.values(), snapshot.node_ids, strict=True))
        adapter.game.id = snapshot.current.game_id
        adapter.reindex(snapshot.current.node_id)
        node_id = node_id or snapshot.current.node_id
        entry = adapter.entries.get(node_id)
        if entry is None or entry.move is None or entry.parent_id is None:
            raise ValueError('请选择包含实战落子的非根节点')
        if adapter.refs[node_id].has_setup_stones():
            raise ValueError('该节点同时包含摆子和落子，无法单独计算实战落子的损失')
        before_context = adapter.context(snapshot.current.revision, entry.parent_id)
        after_context = adapter.context(snapshot.current.revision, node_id)
        # SGF can explicitly record non-alternating turns; search for the actual player.
        before_context.to_play = entry.move.color
        before = await self.analysis.analyze_position(before_context)
        if not before.candidates:
            raise ValueError('KataGo 未返回候选，无法比较实战着')
        actual = next((c for c in before.candidates if c.coordinate.lower() == entry.move.coordinate.lower()), None)
        rank = None
        if actual is None:
            status = 'outside_returned_candidates'
            forced = await self.analysis.analyze_move(before_context, entry.move.coordinate)
            actual = next(c for c in forced.candidates if c.coordinate.lower() == entry.move.coordinate.lower())
        else:
            index = before.candidates.index(actual)
            status = 'best' if index == 0 else 'top_candidate' if index < 3 else 'searched_candidate'
            # A restricted search's order is not a global rank. Only the original
            # unrestricted, complete returned ordering can establish a rank.
            if [c.order for c in before.candidates] == list(range(len(before.candidates))):
                rank = index + 1
        after = await self.analysis.analyze_position(after_context)
        best = before.candidates[0]
        return MoveReview(game_id=snapshot.current.game_id, node_id=node_id, parent_node_id=entry.parent_id,
                          revision=snapshot.current.revision, move_number=entry.move_number,
                          player=entry.move.color, actual_move=entry.move.coordinate,
                          before=evaluation(before, entry.move.color), after=evaluation(after, entry.move.color),
                          actual_move_analysis=actual, best_move=best.coordinate, candidate_moves=before.candidates,
                          score_loss=max(0, best.score_lead - actual.score_lead),
                          winrate_loss=max(0, best.winrate - actual.winrate),
                          actual_move_status=status, actual_move_rank=rank)
