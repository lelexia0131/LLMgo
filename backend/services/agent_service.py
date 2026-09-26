import asyncio
from agents import Runner, RunConfig
from openai import AsyncOpenAI, OpenAIError
from backend.agent.schemas import AgentReply, TeacherAnswer
from backend.agent.teacher import create_teacher
from backend.agent.tools import TeachingContext
from backend.domain.context import GameContext
from backend.services.analysis_service import AnalysisService
from backend.services.settings_service import SettingsService


class AgentService:
    def __init__(self, analysis: AnalysisService, settings: SettingsService) -> None:
        self.analysis, self.settings = analysis, settings
        self.tasks: set[asyncio.Task] = set()

    def client(self) -> AsyncOpenAI:
        if not self.settings.api_key:
            raise ValueError('请在设置中配置 OpenAI API Key')
        return AsyncOpenAI(api_key=self.settings.api_key, base_url='https://api.openai.com/v1',
                           timeout=90, max_retries=1)

    async def ask(self, game: GameContext, question: str) -> AgentReply:
        task = asyncio.current_task()
        assert task is not None
        self.tasks.add(task)
        try:
            async with self.client() as client:
                context = TeachingContext(game=game.model_copy(deep=True), analysis=self.analysis)
                teacher = create_teacher(context, client, self.settings.value.openai_model)
                async with asyncio.timeout(300):
                    result = await Runner.run(teacher, question, max_turns=14,
                                              run_config=RunConfig(tracing_disabled=True))
                if not context.evidence_count:
                    raise ValueError('助教未取得 KataGo 证据，本次回答未发布，请重试')
                answer = TeacherAnswer.model_validate(result.final_output)
                if not set(answer.referenced_markers).issubset({m.id for m in context.game.markers}):
                    raise ValueError('助教引用了无效标记，本次回答未发布，请重试')
                return AgentReply(answer=answer, current_markers=context.game.markers,
                                  tool_calls=context.calls, preview=context.preview)
        except OpenAIError as exc:
            # Never forward request headers or credentials to the renderer.
            raise ValueError(f'OpenAI 请求失败（{type(exc).__name__}），请检查 Key、模型和网络') from None
        finally:
            self.tasks.discard(task)

    async def test(self) -> dict:
        try:
            async with self.client() as client:
                response = await client.responses.create(model=self.settings.value.openai_model,
                                                          input='Reply with OK.', max_output_tokens=32)
                return {'ok': True, 'model': response.model, 'response': response.output_text}
        except OpenAIError as exc:
            raise ValueError(f'OpenAI 请求失败（{type(exc).__name__}），请检查 Key、模型和网络') from None

    async def close(self) -> None:
        tasks = list(self.tasks)
        for task in tasks:
            task.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)
