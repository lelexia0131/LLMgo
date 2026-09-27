import json
from pathlib import Path
import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError
from backend.domain.move import coordinate, point
from backend.domain.analysis import CandidateMove, PositionAnalysis
from backend.services.game_service import GameService
from backend.services.file_service import FileService
from backend.katago.schemas import AnalysisResponse
from backend.evidence.builder import build_evidence
from backend.main import create_app


def test_play_coordinate_orientation_and_stale_revision():
    assert coordinate(11, 16, 19) == 'R12'
    assert point('R12', 19) == (11, 16)
    assert point('pass', 19) is None
    with pytest.raises(ValueError):
        point('I10', 19)
    game = GameService()
    ctx, created = game.play('R12', 0)
    assert created and ctx.move_number == 1
    assert ctx.board_state.sign_map[7][16] == 1
    with pytest.raises(ValueError):
        game.play('Q10', 0)
    game.navigate('first')
    assert not game.context().markers


def test_analysis_candidates_do_not_create_sgf_nodes():
    game = GameService()
    original = game.adapter.serialize()
    ctx = game.set_candidates(['R12', 'Q10', 'C6'], game.revision)
    assert [(m.id, m.coordinate) for m in ctx.markers] == [(1, 'R12'), (2, 'Q10'), (3, 'C6')]
    assert game.adapter.serialize() == original
    played, created = game.play('R12', game.revision)
    assert created and not played.markers and played.move_number == 1


def test_sgf_setup_variation_capture_and_roundtrip(tmp_path):
    data = b'(;FF[4]SZ[19]PB[Black]PW[White]BR[1d]WR[2d]KM[6.5]RU[Japanese]RE[B+R]DT[2026-01-01]HA[2]AB[dd][pp]AW[aa]C[root](;W[qq]C[left];B[])(;W[dc]C[right]))'
    game = GameService()
    files = FileService(game)
    source = tmp_path / 'source.sgf'
    source.write_bytes(data)
    ctx = files.open(str(source))
    assert ctx.to_play == 'W'
    assert ctx.board_state.sign_map[3][3] == 1
    assert ctx.board_state.sign_map[0][0] == -1
    assert ctx.nodes[0].children == ['1', '3']
    assert game.navigate('node', '3').comment == 'right'
    target = tmp_path / 'saved.sgf'
    files.save(str(target))
    reloaded = GameService()
    reloaded.open(target.read_bytes(), target.name)
    assert reloaded.context().metadata == ctx.metadata
    assert reloaded.context().nodes == ctx.nodes
    game.open(b'(;SZ[9]AB[ba][ab][cb]AW[bb];B[bc])', None)
    ctx = game.navigate('last')
    assert ctx.board_state.sign_map[1][1] == 0  # white captured


def test_katago_schema_rejects_invalid_winrate_and_accepts_extensions():
    raw = {'id': '1', 'rootInfo': {'scoreLead': 2.3, 'winrate': .58, 'visits': 100},
           'moveInfos': [{'move': 'R12', 'scoreLead': 2.3, 'winrate': .58, 'visits': 80, 'prior': .2, 'pv': ['R12'], 'newField': True}]}
    assert AnalysisResponse.model_validate(raw).moveInfos[0].move == 'R12'
    raw['rootInfo']['winrate'] = 1.2
    with pytest.raises(ValidationError):
        AnalysisResponse.model_validate(raw)


def test_evidence_only_contains_mapped_candidates():
    game = GameService()
    ctx = game.set_candidates(['R12', 'Q10'], 0)
    result = PositionAnalysis(score_lead=2.3, winrate=.58, visits=100, perspective='B', candidates=[
        CandidateMove(coordinate=c, score_lead=score, winrate=.58, visits=50, prior=.1, pv=[c])
        for c, score in [('R12', 2.3), ('Q10', -1.2), ('C6', 0)]])
    evidence = build_evidence(ctx, result)
    assert evidence.best_marker == 1
    assert [c.marker for c in evidence.candidates] == [1, 2]
    assert 'pv' not in evidence.model_dump_json()


def test_api_auth_sgf_and_secret_redaction(tmp_path, monkeypatch):
    monkeypatch.setenv('OPENAI_API_KEY', 'test-secret-never-render')
    with TestClient(create_app(tmp_path, 'test-token')) as client:
        assert client.get('/health').status_code == 401
        client.headers['Authorization'] = 'Bearer test-token'
        assert client.get('/health').json()['name'] == 'LLMgo'
        assert 'test-secret' not in client.get('/settings').text
        opened = client.post('/game/open', json={'path': str(Path('samples/teaching.sgf').resolve())})
        assert opened.status_code == 200
        state = client.post('/game/navigate', json={'direction': 'last'}).json()
        assert state['move_number'] == 14
        target = tmp_path / 'roundtrip.sgf'
        assert client.post('/game/save', json={'path': str(target)}).status_code == 200
        assert target.exists()
        invalid = client.post('/game/play', json={'coordinate': 'I10', 'revision': state['revision']})
        assert invalid.status_code == 400
