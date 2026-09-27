import asyncio
import os
import subprocess
from collections import deque
from pathlib import Path
from collections.abc import AsyncIterator


class KataGoProcess:
    def __init__(self) -> None:
        self.process: asyncio.subprocess.Process | None = None
        self.stderr: deque[str] = deque(maxlen=40)
        self.stderr_task: asyncio.Task | None = None

    @property
    def running(self) -> bool:
        return self.process is not None and self.process.returncode is None

    async def start(self, executable: str, model: str, config: str, directory: Path) -> None:
        self.stderr.clear()
        self.process = await asyncio.create_subprocess_exec(
            executable, 'analysis', '-model', model, '-config', config,
            '-override-config', f'reportAnalysisWinratesAs=BLACK,homeDataDir={directory.resolve().as_posix()}',
            '-quit-without-waiting', cwd=directory,
            stdin=asyncio.subprocess.PIPE, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE,
            limit=4 * 1024 * 1024,  # Empty 19x19 positions can return hundreds of PVs in one JSON line.
            creationflags=subprocess.CREATE_NO_WINDOW if os.name == 'nt' else 0)
        self.stderr_task = asyncio.create_task(self._stderr())

    async def _stderr(self) -> None:
        assert self.process and self.process.stderr
        async for line in self.process.stderr:
            self.stderr.append(line.decode('utf-8', errors='replace').strip())

    async def lines(self) -> AsyncIterator[bytes]:
        assert self.process and self.process.stdout
        async for line in self.process.stdout:
            yield line
        raise RuntimeError('KataGo 已退出：' + '\n'.join(self.stderr)[-1800:])

    async def write(self, data: bytes) -> None:
        if not self.running or not self.process or not self.process.stdin:
            raise RuntimeError('KataGo 未运行')
        self.process.stdin.write(data + b'\n')
        await self.process.stdin.drain()

    async def close(self) -> None:
        if self.process:
            if self.running:
                if self.process.stdin:
                    self.process.stdin.close()
                try:
                    await asyncio.wait_for(self.process.wait(), 5)
                except TimeoutError:
                    self.process.kill()
                    await self.process.wait()
            if self.stderr_task:
                await self.stderr_task
        self.process = None
