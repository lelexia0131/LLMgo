import argparse
import asyncio
import hmac
import os
from contextlib import asynccontextmanager
from pathlib import Path
import uvicorn
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from backend.katago.client import KataGoClient
from backend.katago.process import KataGoProcess
from backend.services.game_service import GameService
from backend.services.file_service import FileService
from backend.services.settings_service import SettingsService
from backend.services.analysis_service import AnalysisService
from backend.services.agent_service import AgentService
from backend.api.routes import create_routes


def create_app(directory: Path | None = None, token: str | None = None) -> FastAPI:
    settings = SettingsService(directory or Path(os.getenv('LLMGO_DATA_DIR', '.runtime')))
    game = GameService()
    analysis = AnalysisService(KataGoClient(KataGoProcess()), settings)
    agent = AgentService(analysis, settings)

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        yield
        await agent.close()
        await analysis.close()

    app = FastAPI(title='LLMgo Core', lifespan=lifespan, docs_url=None, redoc_url=None, openapi_url=None)

    @app.middleware('http')
    async def authenticate(request: Request, call_next):
        supplied = request.headers.get('authorization', '').removeprefix('Bearer ')
        if not token or not hmac.compare_digest(supplied, token):
            return JSONResponse({'detail': 'Unauthorized'}, status_code=401)
        return await call_next(request)

    @app.exception_handler(ValueError)
    async def invalid(request: Request, exc: ValueError):
        return JSONResponse({'detail': str(exc)}, status_code=400)

    @app.exception_handler(RuntimeError)
    async def unavailable(request: Request, exc: RuntimeError):
        return JSONResponse({'detail': str(exc)}, status_code=503)

    @app.exception_handler(OSError)
    async def io_error(request: Request, exc: OSError):
        return JSONResponse({'detail': '无法访问所选文件或启动程序，请检查路径和权限'}, status_code=400)

    @app.exception_handler(TimeoutError)
    async def timeout(request: Request, exc: TimeoutError):
        return JSONResponse({'detail': '分析请求超时，请降低 visits 或检查引擎'}, status_code=504)

    app.include_router(create_routes(game, FileService(game), analysis, agent, settings))
    return app


async def serve(port: int, parent: int | None) -> None:
    app = create_app(token=os.environ.get('LLMGO_TOKEN'))
    server = uvicorn.Server(uvicorn.Config(app, host='127.0.0.1', port=port, log_level='warning', timeout_graceful_shutdown=5))

    async def watch_parent() -> None:
        if parent is None:
            return
        if os.name == 'nt':
            import ctypes
            kernel = ctypes.windll.kernel32
            kernel.OpenProcess.restype = ctypes.c_void_p
            kernel.WaitForSingleObject.argtypes = [ctypes.c_void_p, ctypes.c_ulong]
            kernel.CloseHandle.argtypes = [ctypes.c_void_p]
            handle = kernel.OpenProcess(0x00100000, False, parent)
            try:
                while handle and kernel.WaitForSingleObject(handle, 0) == 258:
                    await asyncio.sleep(1)
            finally:
                if handle:
                    kernel.CloseHandle(handle)
            server.should_exit = True
        else:
            while os.getppid() == parent:
                await asyncio.sleep(1)
            server.should_exit = True

    watcher = asyncio.create_task(watch_parent())
    try:
        await server.serve()
    finally:
        watcher.cancel()
        await asyncio.gather(watcher, return_exceptions=True)


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--port', type=int, required=True)
    parser.add_argument('--parent-pid', type=int)
    args = parser.parse_args()
    asyncio.run(serve(args.port, args.parent_pid))
