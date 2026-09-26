import asyncio
import json
from pathlib import Path
from uuid import uuid4
from backend.katago.process import KataGoProcess
from backend.katago.schemas import AnalysisResponse


class KataGoClient:
    def __init__(self, process: KataGoProcess) -> None:
        self.process = process
        self.pending: dict[str, asyncio.Future] = {}
        self.reader: asyncio.Task | None = None
        self.lock = asyncio.Lock()
        self.queue = asyncio.Semaphore(2)
        self.signature: tuple[str, str, str] | None = None

    async def ensure_started(self, paths: tuple[str, str, str], directory: Path) -> None:
        async with self.lock:
            if paths == self.signature and self.process.running and self.reader and not self.reader.done():
                return
            await self.close()
            await self.process.start(*paths, directory)
            self.signature = paths
            self.reader = asyncio.create_task(self._read())

    async def _read(self) -> None:
        try:
            async for line in self.process.lines():
                message = json.loads(line)
                future = self.pending.get(message.get('id'))
                if future is None or future.done() or message.get('isDuringSearch'):
                    continue
                if 'error' in message:
                    future.set_exception(ValueError('KataGo: ' + str(message['error'])))
                elif 'rootInfo' in message:
                    try:
                        future.set_result(AnalysisResponse.model_validate(message))
                    except ValueError as exc:
                        future.set_exception(exc)
        except (Exception, asyncio.CancelledError) as exc:
            for future in self.pending.values():
                if not future.done():
                    future.set_exception(RuntimeError(str(exc) or 'KataGo 请求已取消'))

    async def request(self, payload: dict, timeout: float = 180) -> AnalysisResponse:
        async with self.queue:
            request_id = uuid4().hex
            future = asyncio.get_running_loop().create_future()
            self.pending[request_id] = future
            try:
                await self.process.write(json.dumps({**payload, 'id': request_id}).encode())
                return await asyncio.wait_for(future, timeout)
            except (TimeoutError, asyncio.CancelledError):
                if self.process.running:
                    await self.process.write(json.dumps({'id': uuid4().hex, 'action': 'terminate', 'terminateId': request_id}).encode())
                raise
            finally:
                self.pending.pop(request_id, None)

    async def close(self) -> None:
        if self.reader:
            self.reader.cancel()
            await asyncio.gather(self.reader, return_exceptions=True)
            self.reader = None
        await self.process.close()
        self.signature = None
