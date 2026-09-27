from agents import OpenAIResponsesModel, OpenAIChatCompletionsModel
from openai import AsyncOpenAI
from backend.services.settings_service import SettingsService


class LLMProvider:
    """One client factory and two SDK transports; tools and evidence stay shared."""

    def __init__(self, settings: SettingsService) -> None:
        self.settings = settings

    def client(self) -> AsyncOpenAI:
        if not self.settings.api_key:
            raise ValueError('请在 AI / API 设置中配置 API Key')
        return AsyncOpenAI(api_key=self.settings.api_key, base_url=self.settings.value.base_url,
                           timeout=90, max_retries=1)

    def model(self, client: AsyncOpenAI):
        model_type = OpenAIResponsesModel if self.settings.value.provider == 'openai' else OpenAIChatCompletionsModel
        return model_type(model=self.settings.value.openai_model, openai_client=client)

    async def test(self, client: AsyncOpenAI) -> dict:
        model = self.settings.value.openai_model
        if self.settings.value.provider == 'openai':
            response = await client.responses.create(model=model, input='Reply with OK.', max_output_tokens=32)
            text = response.output_text
        else:
            response = await client.chat.completions.create(model=model, messages=[{'role': 'user', 'content': 'Reply with OK.'}], max_tokens=32)
            text = response.choices[0].message.content
        return {'ok': True, 'model': response.model, 'response': text}
