import asyncio
from types import SimpleNamespace
from unittest.mock import AsyncMock
import pytest
from agents import OpenAIResponsesModel, OpenAIChatCompletionsModel
from backend.agent.provider import LLMProvider
from backend.domain.analysis import CandidateMove, PositionAnalysis
from backend.services.game_service import GameService
from backend.services.analysis_service import AnalysisService
from backend.services.settings_service import Settings, SettingsService


def play(game, coordinate):
    return game.play(coordinate, game.revision)[0]


def test_edit_variation_comment_undo_redo_roundtrip():
    game = GameService()
    game.open(b'(;CA[UTF-8]SZ[9]PB[A]PW[B]HA[2]AB[cc][gg]C[root];W[dd];B[ee])', 'test.sgf')
    root = game.context()
    original = game.adapter.serialize()
    added = play(game, 'A1')
    assert added.to_play == 'B' and added.move_number == 1
    assert added.nodes[0].children == ['1', added.node_id]
    assert added.can_undo and not added.markers
    game.comment('variation ] \\ comment\n中文', game.revision)
    second = play(game, 'B1')
    expected = game.adapter.serialize()
    expected_nodes = game.context().nodes
    game.edit('deleteNode', game.revision)
    game.edit('undo', game.revision)
    assert game.context().node_id == second.node_id
    assert game.adapter.serialize() == expected
    game.edit('deleteBranch', game.revision)
    assert game.adapter.serialize() == original
    game.edit('undo', game.revision)
    assert game.context().nodes == expected_nodes
    game.edit('redo', game.revision)
    assert game.adapter.serialize() == original
    game.edit('undo', game.revision)
    reloaded = GameService()
    reloaded.open(game.adapter.serialize(), None)
    assert reloaded.adapter.serialize() == expected
    assert reloaded.context().metadata == root.metadata
    branch = reloaded.adapter.game.nodes[0].children[1]
    assert reloaded.navigate('node', branch).comment == 'variation ] \\ comment\n中文'
    assert reloaded.navigate('next').move_number == 2


def test_existing_move_navigation_and_new_edit_clears_redo():
    game = GameService()
    first = play(game, 'D4')
    game.navigate('first')
    same, created = game.play('D4', game.revision)
    assert same.node_id == first.node_id and not created
    assert len(same.nodes) == 2
    game.edit('undo', game.revision)
    assert game.context().can_redo
    play(game, 'Q16')
    assert not game.context().can_redo
    assert game.context().node_id != first.node_id


def test_move_number_settings_persist_and_validate(tmp_path):
    settings = SettingsService(tmp_path)
    assert settings.value.move_number_mode == 'off'
    for mode in ('latest', 'all', 'off'):
        settings.update(settings.value.model_copy(update={'move_number_mode': mode}))
        assert SettingsService(tmp_path).value.move_number_mode == mode
    with pytest.raises(ValueError):
        Settings(move_number_mode='invalid')


def test_numbering_after_110_passes_setup_and_captures():
    game = GameService()
    moves = ''.join(';B[]' if i % 2 == 0 else ';W[]' for i in range(110))
    game.open(f'(;SZ[9]AB[cc]{moves})'.encode(), None)
    game.navigate('last')
    assert game.context().move_number == 110
    assert not any(n for row in game.context().board_state.move_numbers for n in row)
    ctx = play(game, 'D4')
    assert ctx.board_state.move_numbers[5][3] == 111
    ctx = play(game, 'E4')
    assert ctx.board_state.move_numbers[5][4] == 112
    assert ctx.board_state.move_numbers[2][2] == 0
    game.open(b'(;SZ[9]AB[ba][ab][cb];W[bb];B[bc];W[];AB[hh])', None)
    ctx = game.navigate('last')
    assert ctx.move_number == 3
    assert ctx.board_state.move_numbers[1][1] == 0
    assert ctx.board_state.move_numbers[2][1] == 2
    assert ctx.board_state.move_numbers[7][7] == 0


def test_illegal_occupied_suicide_and_ko_do_not_edit():
    game = GameService()
    play(game, 'D4')
    before = game.adapter.serialize()
    with pytest.raises(ValueError, match='已有棋子'):
        play(game, 'D4')
    assert game.adapter.serialize() == before
    game.open(b'(;SZ[9]AW[ba][ab]PL[B])', None)
    with pytest.raises(ValueError, match='自杀'):
        play(game, 'A9')
    # Black captures C7 at C8; white cannot immediately recapture.
    game.open(b'(;SZ[9]RU[Japanese]AB[bc][dc][cd]AW[bb][db][ca][cc]PL[B])', None)
    play(game, 'C8')
    before = game.adapter.serialize()
    with pytest.raises(ValueError, match='劫争'):
        play(game, 'C7')
    assert game.adapter.serialize() == before
    play(game, 'pass')
    play(game, 'pass')
    play(game, 'C7')


def test_unicode_comment_upgrades_legacy_encoding_and_undo_restores_bytes():
    game = GameService()
    game.open(b'(;SZ[9]PB[Ren\xe9];B[dd])', None)
    original = game.adapter.serialize()
    game.comment('中文注释', game.revision)
    data = game.adapter.serialize()
    loaded = GameService()
    ctx = loaded.open(data, None)
    assert ctx.comment == '中文注释' and ctx.metadata['PB'] == 'René'
    game.edit('undo', game.revision)
    assert game.adapter.serialize() == original


@pytest.mark.parametrize('properties,label', [('', '分先'), ('HA[1]KM[0]', '让先'), ('HA[3]AB[cc][gg][cg]', '让 3 子'), ('AB[cc]AW[gg]PL[W]KM[0]', '摆子局面')])
def test_game_form_metadata(properties, label):
    game = GameService()
    ctx = game.open(f'(;SZ[9]{properties};B[])'.encode(), None)
    assert ctx.metadata['game_form'] == label
    assert ctx.move_number == 0


@pytest.mark.parametrize('provider,url,model_type', [('openai', 'https://api.openai.com/v1', OpenAIResponsesModel), ('deepseek', 'https://api.deepseek.com', OpenAIChatCompletionsModel), ('compatible', 'http://localhost:8000/v1', OpenAIChatCompletionsModel)])
def test_provider_transport_and_persistence(tmp_path, provider, url, model_type):
    settings = SettingsService(tmp_path)
    settings.api_key = 'private-test-key'
    adapter = LLMProvider(settings)
    model = 'deepseek-chat' if provider == 'deepseek' else 'test-model'
    async def check():
        async with adapter.client():
            pass
        settings.update(Settings(provider=provider, base_url=url, openai_model=model))
        async with adapter.client() as client:
            assert str(client.base_url).rstrip('/') == url
            assert isinstance(adapter.model(client), model_type)
            assert adapter.model(client).model == model
            assert client.api_key == settings.api_key
    asyncio.run(check())
    assert 'private-test-key' not in str(settings.public())
    assert 'private-test-key' not in settings.store.path.read_text()
    restored = SettingsService(tmp_path).value
    assert (restored.provider, restored.base_url, restored.openai_model) == (provider, url, model)


def test_engine_initialization_idempotence_shutdown_and_move_loss():
    async def check():
        process = SimpleNamespace(running=True)
        client = SimpleNamespace(process=process, close=AsyncMock())
        analysis = AnalysisService(client, None)
        result = PositionAnalysis(score_lead=40, winrate=.99, visits=100, perspective='W', candidates=[
            CandidateMove(coordinate=c, score_lead=s, winrate=.9, visits=50, prior=.5, pv=[c])
            for c, s in [('D4', 5), ('Q16', 1.5)]])
        analysis.analyze_position = AsyncMock(return_value=result)
        analysis.initialize()
        startup = analysis.startup
        analysis.initialize()
        assert analysis.startup is startup and analysis.status == 'starting'
        await startup
        assert analysis.status == 'ready'
        analysis.initialize()
        assert analysis.startup is startup
        assert await analysis.move_loss(None, 'Q16') == 3.5
        await analysis.close()
        client.close.assert_awaited_once()
        assert analysis.status == 'stopped'
    asyncio.run(check())


def test_engine_stdout_accepts_large_19x19_response(tmp_path):
    import sys
    from backend.katago.process import KataGoProcess
    async def check():
        process = KataGoProcess()
        # Python serves as a deterministic local producer through the actual process wrapper.
        script = tmp_path / 'analysis'
        script.write_text("print('x' * 100000, flush=True)\n", encoding='utf-8')
        try:
            await process.start(sys.executable, 'unused', 'unused', tmp_path)
            lines = process.lines()
            assert (await anext(lines)).rstrip(b'\r\n') == b'x' * 100000
            await lines.aclose()
        finally:
            await process.close()
    asyncio.run(check())


@pytest.mark.parametrize('backend,key', [('opencl', 'openclDeviceToUse'), ('trt-cuda', 'trtDeviceToUse'), ('cuda', 'cudaDeviceToUse')])
def test_engine_overrides_preserve_original_config(tmp_path, backend, key):
    executable = tmp_path / f'katago-{backend}.exe'
    model = tmp_path / 'model.bin'
    config = tmp_path / 'analysis.cfg'
    original = 'numSearchThreadsPerAnalysisThread = 16\nnumSearchThreads = 8\n'
    executable.touch()
    model.touch()
    config.write_text(original)
    settings = SettingsService(tmp_path / 'data')
    settings.update(Settings(katago_executable=str(executable), katago_model=str(model), katago_config=str(config), engine_threads=4, engine_gpu=1))
    effective = settings.engine_paths()[2]
    assert config.read_text() == original
    text = __import__('pathlib').Path(effective).read_text()
    assert 'numSearchThreadsPerAnalysisThread = 4' in text
    assert 'numSearchThreads = 8' not in text
    assert f'{key} = 1' in text


def test_provider_errors_preserve_details_without_credentials(tmp_path):
    import httpx2
    from openai import APIConnectionError, AuthenticationError
    from backend.services.agent_service import AgentService
    settings = SettingsService(tmp_path)
    settings.api_key = 'private-test-key'
    service = AgentService(None, settings)
    request = httpx2.Request('POST', 'https://api.deepseek.com/chat/completions')
    error = AuthenticationError('rejected', response=httpx2.Response(401, request=request),
                                body={'message': f'Invalid API key: {settings.api_key}'})
    message = service.error_message(error)
    assert 'HTTP 401' in message and 'Invalid API key' in message
    assert settings.api_key not in message
    error = APIConnectionError(request=request)
    error.__cause__ = OSError('connection refused')
    assert 'connection refused' in service.error_message(error)
