"""Real local engine acceptance. OpenAI calls only run with --openai and a supplied key."""
import argparse
import asyncio
import json
from pathlib import Path
from agents.tool_context import ToolContext
from backend.services.settings_service import SettingsService
from backend.services.game_service import GameService
from backend.services.analysis_service import AnalysisService
from backend.services.agent_service import AgentService
from backend.katago.client import KataGoClient
from backend.katago.process import KataGoProcess
from backend.agent.tools import TeachingContext, create_tools


async def main(openai: bool) -> None:
    settings = SettingsService(Path('.runtime/real-smoke'))
    settings.value.visits = 100
    game = GameService()
    game.open(Path('samples/teaching.sgf').read_bytes(), 'teaching.sgf')
    game.navigate('node', '10')
    process = KataGoProcess()
    analysis = AnalysisService(KataGoClient(process), settings)
    agent = AgentService(analysis, settings)
    report: dict = {'engine': settings.value.katago_executable, 'openai': 'not configured / not requested'}
    try:
        print('Starting real KataGo...', flush=True)
        result = await analysis.analyze_position(game.context())
        pid = process.process.pid if process.process else None
        assert result.visits >= 100 and len(result.candidates) >= 3
        ctx = game.set_candidates([c.coordinate for c in result.candidates[:3]], game.revision)
        cached = await analysis.analyze_position(ctx)
        assert cached.cached
        teaching = TeachingContext(ctx, analysis)
        tools = {t.name: t for t in create_tools(teaching)}
        wrapper = ToolContext(context=None, tool_name='analysis_smoke', tool_call_id='smoke', tool_arguments='{}')
        evidence = await tools['analyze_marker'].on_invoke_tool(wrapper, json.dumps({'marker_id': 2}))
        assert evidence['candidates'][0]['marker'] == 2
        comparison = await tools['compare_markers'].on_invoke_tool(wrapper, json.dumps({'marker_ids': [1, 2]}))
        assert len(comparison) == 2
        variation = await tools['analyze_variation'].on_invoke_tool(wrapper, json.dumps({'marker_id': 2}))
        assert variation['variation']['steps'][0]['coordinate'] == ctx.markers[1].coordinate
        game.reset_markers()
        free = next(f'{"ABCDEFGHJKLMNOPQRST"[x]}{19-y}' for y, row in enumerate(ctx.board_state.sign_map) for x, sign in enumerate(row) if sign == 0 and 3 <= x <= 15 and 3 <= y <= 15)
        temporary = game.select(free, game.revision)
        free_result = await analysis.analyze_move(temporary, temporary.markers[0].coordinate)
        assert free_result.candidates[0].coordinate == free
        report.update({'katago': 'passed', 'visits': result.visits, 'pid': pid, 'markers': [m.model_dump() for m in ctx.markers],
                       'sdk_tools_real_katago': teaching.calls, 'temporary_marker': free, 'cache': 'passed'})
        if openai:
            report['openai'] = await agent.test()
            reply = await agent.ask(ctx, '为什么 2 不好？请通过工具与首选比较，不要先入为主。')
            assert any(c.startswith('analyze_marker(2)') for c in reply.tool_calls)
            assert any(c.startswith('compare_markers') for c in reply.tool_calls)
            report['agent'] = reply.model_dump()
        print(json.dumps(report, ensure_ascii=False, indent=2), flush=True)
    finally:
        await agent.close()
        await analysis.close()
        assert not process.running
        report['katago_shutdown'] = 'passed'
        Path('.runtime/real-smoke-report.json').write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--openai', action='store_true')
    args = parser.parse_args()
    asyncio.run(main(args.openai))
