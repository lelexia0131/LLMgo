import os
from pathlib import Path
from pydantic import BaseModel, Field, ConfigDict
from backend.katago.discovery import discover_engines
from backend.persistence.settings_store import SettingsStore


class Settings(BaseModel):
    model_config = ConfigDict(extra='forbid')
    katago_executable: str = ''
    katago_model: str = ''
    katago_config: str = ''
    visits: int = Field(default=400, ge=16, le=100000)
    openai_model: str = Field(default='gpt-5.6', min_length=1, max_length=120)


class SettingsService:
    def __init__(self, directory: Path) -> None:
        self.store = SettingsStore(directory)
        values = self.store.load()
        values.setdefault('openai_model', os.getenv('OPENAI_MODEL', 'gpt-5.6'))
        self.value = Settings(**values)
        self.api_key = os.getenv('OPENAI_API_KEY', '')
        self.directory = directory
        self.directory.mkdir(parents=True, exist_ok=True)
        engines = discover_engines()
        if not self.value.katago_executable and engines:
            # Prefer a broadly usable backend; users may explicitly select TensorRT.
            engines.sort(key=lambda e: 'opencl' not in str(e['name']).lower())
            engine = engines[0]
            self.value.katago_executable = str(engine['executable'])
            self.value.katago_model = next(iter(engine['models']), '')
            self.value.katago_config = next(iter(engine['configs']), '')

    def public(self) -> dict:
        return {**self.value.model_dump(), 'has_api_key': bool(self.api_key), 'engines': discover_engines()}

    def update(self, values: Settings) -> dict:
        self.store.save(values.model_dump())
        self.value = values
        return self.public()

    def engine_paths(self) -> tuple[str, str, str]:
        paths = (self.value.katago_executable, self.value.katago_model, self.value.katago_config)
        if not all(p and Path(p).is_file() for p in paths):
            raise ValueError('请在设置中选择有效的 KataGo 引擎、模型和分析配置')
        return paths
