import os
import tempfile
from pathlib import Path
from backend.services.game_service import GameService
from backend.domain.context import GameContext


class FileService:
    def __init__(self, game: GameService) -> None:
        self.game = game
        self.path: Path | None = None

    @staticmethod
    def sgf_path(path: str) -> Path:
        target = Path(path).resolve()
        if target.suffix.lower() != '.sgf':
            raise ValueError('请选择 .sgf 文件')
        return target

    def open(self, path: str) -> GameContext:
        target = self.sgf_path(path)
        if target.stat().st_size > 8 * 1024 * 1024:
            raise ValueError('棋谱超过 8 MB 限制')
        result = self.game.open(target.read_bytes(), target.name)
        self.path = target
        return result

    def save(self, path: str | None = None) -> dict[str, str]:
        target = self.sgf_path(path) if path else self.path
        if target is None:
            raise ValueError('请先选择保存位置')
        temporary: str | None = None
        try:
            with tempfile.NamedTemporaryFile(dir=target.parent, delete=False) as stream:
                temporary = stream.name
                stream.write(self.game.adapter.serialize())
            os.replace(temporary, target)
        finally:
            if temporary and Path(temporary).exists():
                Path(temporary).unlink()
        self.path = target
        self.game.filename = target.name
        return {'filename': target.name}
