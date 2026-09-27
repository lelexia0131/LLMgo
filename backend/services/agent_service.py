import asyncio
import re
from agents import Runner, RunConfig
from openai import AsyncOpenAI, OpenAIError, APIConnectionError, APIStatusError
from backend.agent.schemas import AgentReply, TeacherAnswer
from backend.agent.teacher import create_teacher
from backend.agent.tools import TeachingContext
from backend.domain.context import GameContext
from backend.services.analysis_service import AnalysisService
from backend.services.settings_service import SettingsService
from backend.agent.provider import LLMProvider


class AgentService:
    def __init__(self, analysis: AnalysisService, settings: SettingsService) -> None:
        self.analysis, self.settings = analysis, settings
        self.tasks: set[asyncio.Task] = set()
        self.provider = LLMProvider(settings)

    def client(self) -> AsyncOpenAI:
        return self.provider.client()

    async def ask(self, game: GameContext, question: str) -> AgentReply:
        task = asyncio.current_task()
        assert task is not None
        self.tasks.add(task)
        try:
            async with self.client() as client:
                context = TeachingContext(game=game.model_copy(deep=True), analysis=self.analysis)
                teacher = create_teacher(context, client, self.provider)
                async with asyncio.timeout(300):
                    result = await Runner.run(teacher, question, max_turns=14,
                                              run_config=RunConfig(tracing_disabled=True))
                if not context.evidence_count:
                    raise ValueError('助教未取得 KataGo 证据，本次回答未发布，请重试')
                answer = TeacherAnswer.model_validate_json(result.final_output) if isinstance(result.final_output, str) else TeacherAnswer.model_validate(result.final_output)
                if not set(answer.referenced_markers).issubset({m.id for m in context.game.markers}):
                    raise ValueError('助教引用了无效标记，本次回答未发布，请重试')
                return AgentReply(answer=answer, current_markers=context.game.markers,
                                  tool_calls=context.calls, preview=context.preview)
        except OpenAIError as exc:
            raise ValueError(self.error_message(exc)) from None
        finally:
            self.tasks.discard(task)

    async def test(self) -> dict:
        try:
            async with self.client() as client:
                return await self.provider.test(client)
        except OpenAIError as exc:
            raise ValueError(self.error_message(exc)) from None

    def error_message(self, exc: OpenAIError) -> str:
        detail = str(exc)
        if isinstance(exc, APIStatusError) and isinstance(exc.body, dict):
            body = exc.body.get('error', exc.body)
            if isinstance(body, dict):
                detail = str(body.get('message', detail))
        if isinstance(exc, APIConnectionError) and exc.__cause__:
            detail += f' {type(exc.__cause__).__name__}: {exc.__cause__}'
        # Keep the useful API/network error, never the configured key or URL credentials.
        if self.settings.api_key:
            detail = detail.replace(self.settings.api_key, '[已隐藏]')
        detail = re.sub(r'(?i)Bearer\s+[^\s,;\'"}]+', 'Bearer [已隐藏]', detail)
        detail = re.sub(r'(https?://)[^/\s@]+@', r'\1[已隐藏]@', detail)
        status = f' HTTP {exc.status_code}' if isinstance(exc, APIStatusError) else ''
        return f'LLM 请求失败（{self.settings.value.provider} · {type(exc).__name__}{status}）：{detail[:800]}'

    async def close(self) -> None:
        tasks = list(self.tasks)
        for task in tasks:
            task.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)
