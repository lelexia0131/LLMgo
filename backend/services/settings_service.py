import os
import re
from typing import Literal
from urllib.parse import urlparse
from pathlib import Path
from pydantic import BaseModel, Field, ConfigDict, field_validator
from backend.katago.discovery import discover_engines
from backend.persistence.settings_store import SettingsStore


class Settings(BaseModel):
    model_config = ConfigDict(extra='forbid')
    katago_executable: str = ''
    katago_model: str = ''
    katago_config: str = ''
    visits: int = Field(default=400, ge=16, le=100000)
    openai_model: str = Field(default='gpt-5.6', min_length=1, max_length=120)
    provider: Literal['openai', 'deepseek', 'compatible'] = 'openai'
    base_url: str = 'https://api.openai.com/v1'
    sound_enabled: bool = True
    move_number_mode: Literal['off', 'latest', 'all'] = 'off'
    engine_threads: int = Field(default=0, ge=0, le=256)
    engine_gpu: int = Field(default=-1, ge=-1, le=32)

    @field_validator('base_url')
    @classmethod
    def validate_url(cls, value: str) -> str:
        parsed = urlparse(value)
        if parsed.scheme not in ('https', 'http') or not parsed.netloc or parsed.username or parsed.password or parsed.query or parsed.fragment:
            raise ValueError('Base URL 必须是有效的 HTTP(S) 服务地址，不能包含凭据或查询参数')
        return value.rstrip('/')


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
        overrides = {}
        if self.value.engine_threads:
            overrides['numSearchThreadsPerAnalysisThread'] = self.value.engine_threads
        if self.value.engine_gpu >= 0:
            name = paths[0].lower()
            if 'opencl' in name:
                overrides['openclDeviceToUse'] = self.value.engine_gpu
            elif 'tensorrt' in name or 'trt' in name:
                overrides['trtDeviceToUse'] = self.value.engine_gpu
            elif 'cuda' in name:
                overrides['cudaDeviceToUse'] = self.value.engine_gpu
            else:
                raise ValueError('无法识别此执行程序的 GPU backend，请设为自动或在 config 中配置 GPU')
        if overrides:
            text = Path(paths[2]).read_text(encoding='utf-8-sig')
            if self.value.engine_threads:
                text = re.sub(r'^\s*numSearchThreads\s*=.*$', '', text, flags=re.MULTILINE)
            for key, value in overrides.items():
                text = re.sub(rf'^\s*{key}\s*=.*$', '', text, flags=re.MULTILINE)
                text += f'\n{key} = {value}\n'
            generated = self.directory / 'engine-effective.cfg'
            if not generated.exists() or generated.read_text(encoding='utf-8') != text:
                generated.write_text(text, encoding='utf-8')
            paths = (paths[0], paths[1], str(generated))
        return paths
