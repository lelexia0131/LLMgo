import asyncio
from fastapi import APIRouter
from backend.api.schemas import OpenGame, SaveGame, Navigate, Revision, SelectPoint, MarkerRequest, PreviewRequest, AskRequest, Credential
from backend.services.game_service import GameService
from backend.services.file_service import FileService
from backend.services.analysis_service import AnalysisService
from backend.services.agent_service import AgentService
from backend.services.settings_service import SettingsService, Settings
from backend.domain.context import GameContext
from backend.domain.analysis import VariationPreview


def create_routes(game: GameService, files: FileService, analysis: AnalysisService,
                  agent: AgentService, settings: SettingsService) -> APIRouter:
    router = APIRouter()
    operation = asyncio.Lock()

    @router.get('/health')
    def health() -> dict:
        return {'ok': True, 'name': 'LLMgo', 'katago': 'running' if analysis.client.process.running else 'stopped'}

    @router.get('/game/state')
    def state() -> GameContext:
        return game.context()

    @router.post('/game/open')
    async def open_game(body: OpenGame) -> GameContext:
        async with operation:
            return files.open(body.path)

    @router.post('/game/save')
    async def save_game(body: SaveGame) -> dict:
        async with operation:
            return files.save(body.path)

    @router.post('/game/navigate')
    async def navigate(body: Navigate) -> GameContext:
        async with operation:
            return game.navigate(body.direction, body.node_id)

    @router.post('/game/select')
    async def select(body: SelectPoint) -> GameContext:
        async with operation:
            return game.select(body.coordinate, body.revision)

    @router.post('/game/clear-markers')
    async def clear(body: Revision) -> GameContext:
        async with operation:
            game.check(body.revision)
            game.reset_markers()
            return game.context()

    @router.post('/analysis/current')
    async def current(body: Revision) -> dict:
        async with operation:
            game.check(body.revision)
            result = await analysis.analyze_position(game.context())
            context = game.set_candidates([c.coordinate for c in result.candidates[:3]], body.revision)
            return {'analysis': result, 'context': context}

    @router.post('/analysis/marker')
    async def marker(body: MarkerRequest) -> dict:
        async with operation:
            game.check(body.revision)
            context = game.context()
            target = next((m for m in context.markers if m.id == body.marker_id), None)
            if target is None:
                raise ValueError('数字标记已失效')
            result = await analysis.analyze_position(context) if target.role == 'stone' else await analysis.analyze_move(context, target.coordinate)
            return {'analysis': result, 'context': context}

    @router.post('/analysis/preview')
    async def preview(body: PreviewRequest) -> VariationPreview:
        async with operation:
            game.check(body.revision)
            context = game.context()
            target = next((m for m in context.markers if m.id == body.marker_id), None)
            if target is None:
                raise ValueError('数字标记已失效')
            result = await analysis.analyze_move(context, target.coordinate)
            return analysis.preview(context, result.candidates[0].pv, 100 if body.full else 5)

    @router.post('/agent/ask')
    async def ask(body: AskRequest) -> dict:
        async with operation:
            game.check(body.revision)
            # Rebuild a fresh question context while preserving IDs referenced in the question.
            game.revision += 1
            reply = await agent.ask(game.context(), body.question)
            game.markers = reply.current_markers
            return {'reply': reply, 'context': game.context()}

    @router.get('/settings')
    def get_settings() -> dict:
        return settings.public()

    @router.post('/settings')
    async def update_settings(body: Settings) -> dict:
        async with operation:
            await analysis.close()
            game.reset_markers()
            return settings.update(body)

    @router.post('/settings/credential')
    async def credential(body: Credential) -> dict:
        async with operation:
            settings.api_key = body.api_key.strip()
            return {'has_api_key': bool(settings.api_key)}

    @router.post('/settings/test-katago')
    async def test_katago() -> dict:
        async with operation:
            result = await analysis.analyze_position(game.context())
            return {'ok': True, 'visits': result.visits, 'candidates': len(result.candidates), 'cached': result.cached}

    @router.post('/settings/test-openai')
    async def test_openai() -> dict:
        return await agent.test()

    @router.post('/shutdown')
    async def shutdown() -> dict:
        await agent.close()
        await analysis.close()
        return {'ok': True}

    return router
