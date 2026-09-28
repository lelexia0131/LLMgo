import asyncio
from fastapi import APIRouter
from backend.api.schemas import OpenGame, SaveGame, Navigate, Revision, PlayMove, EditGame, Comment, MarkerRequest, PreviewRequest, AskRequest, Credential
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
    searches: set[asyncio.Task] = set()

    async def stop_searches() -> None:
        for task in list(searches):
            task.cancel()
        await asyncio.gather(*list(searches), return_exceptions=True)

    @router.get('/health')
    def health() -> dict:
        status = analysis.status
        if status == 'ready' and not analysis.client.process.running:
            status = 'error'
        return {'ok': True, 'name': 'LLMgo', 'katago': status, 'error': analysis.error,
                'logs': list(analysis.client.process.stderr)}

    @router.post('/engine/start')
    async def start_engine() -> dict:
        analysis.initialize()
        return health()

    @router.post('/engine/restart')
    async def restart_engine() -> dict:
        await stop_searches()
        await analysis.close()
        analysis.initialize()
        return health()

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

    @router.post('/game/play')
    async def play(body: PlayMove) -> dict:
        async with operation:
            context, created = game.play(body.coordinate, body.revision)
            return {'context': context, 'created': created}

    @router.post('/game/edit')
    async def edit(body: EditGame) -> GameContext:
        async with operation:
            return game.edit(body.action, body.revision)

    @router.post('/game/comment')
    async def comment(body: Comment) -> GameContext:
        async with operation:
            return game.comment(body.text, body.revision)

    @router.post('/analysis/stop')
    async def stop_analysis() -> dict:
        await stop_searches()
        return {'ok': True}

    @router.post('/analysis/current')
    async def current(body: Revision) -> dict:
        task = asyncio.current_task()
        searches.add(task)
        try:
            game.check(body.revision)
            snapshot = game.context()
            entry = game.adapter.entries[snapshot.node_id]
            parent = game.adapter.context(body.revision, entry.parent_id) if entry.parent_id is not None and entry.move else None
            result = await analysis.analyze_position(snapshot)
            loss = await analysis.move_loss(parent, entry.move.coordinate) if parent and entry.move and entry.move.color == parent.to_play else None
            game.check(body.revision)
            if loss is not None:
                game.move_losses[snapshot.node_id] = loss
            context = game.set_candidates([c.coordinate for c in result.candidates[:3]], body.revision)
            return {'analysis': result, 'context': context}
        except asyncio.CancelledError:
            return {'cancelled': True}
        finally:
            searches.discard(task)

    @router.post('/analysis/marker')
    async def marker(body: MarkerRequest) -> dict:
        async with operation:
            game.check(body.revision)
            context = game.context()
            target = next((m for m in context.markers if m.id == body.marker_id), None)
            if target is None:
                raise ValueError('数字标记已失效')
            result = await analysis.analyze_move(context, target.coordinate)
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
            snapshot = game.review_snapshot()
            reply = await agent.ask(snapshot.current, body.question, snapshot=snapshot)
            game.revision += 1
            game.markers = reply.current_markers
            return {'reply': reply, 'context': game.context()}

    @router.get('/settings')
    def get_settings() -> dict:
        return settings.public()

    @router.post('/settings')
    async def update_settings(body: Settings) -> dict:
        async with operation:
            changed = any(getattr(body, key) != getattr(settings.value, key) for key in ('katago_executable', 'katago_model', 'katago_config', 'visits', 'engine_threads', 'engine_gpu'))
            if changed:
                await stop_searches()
                await analysis.close()
                game.reset_markers()
                game.move_losses.clear()
            result = settings.update(body)
            if changed:
                analysis.initialize()
            return result

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
        await stop_searches()
        await agent.close()
        await analysis.close()
        return {'ok': True}

    return router
