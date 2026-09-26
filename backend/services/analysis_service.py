import json
from sgfmill import boards
from backend.domain.analysis import CandidateMove, PositionAnalysis, VariationPreview
from backend.domain.context import GameContext
from backend.domain.move import point
from backend.katago.client import KataGoClient
from backend.services.settings_service import SettingsService


class AnalysisService:
    def __init__(self, client: KataGoClient, settings: SettingsService) -> None:
        self.client = client
        self.settings = settings
        self.cache: dict[str, PositionAnalysis] = {}

    async def analyze_position(self, context: GameContext, allowed: list[str] | None = None) -> PositionAnalysis:
        paths = self.settings.engine_paths()
        await self.client.ensure_started(paths, self.settings.directory)
        rules = context.metadata.get('RU', 'chinese').lower()
        rules = {'japanese': 'japanese', 'chinese': 'chinese', 'aga': 'aga', 'korean': 'korean',
                 'jp': 'japanese', 'cn': 'chinese', 'chinese rules': 'chinese'}.get(rules, rules)
        payload = {'initialStones': [[m.color, m.coordinate] for m in context.initial_stones],
                   'moves': [[m.color, m.coordinate] for m in context.move_history],
                   'initialPlayer': context.initial_player, 'rules': rules,
                   'komi': float(context.metadata.get('KM', '7.5')),
                   'boardXSize': context.board_state.size, 'boardYSize': context.board_state.size,
                   'maxVisits': self.settings.value.visits, 'analysisPVLen': 16}
        # PL can explicitly override the alternating player after the last move.
        inferred = ('W' if context.move_history[-1].color == 'B' else 'B') if context.move_history else context.initial_player
        if inferred != context.to_play:
            payload['initialStones'] = [['B' if sign == 1 else 'W', f'{"ABCDEFGHJKLMNOPQRST"[x]}{context.board_state.size-y}']
                                        for y, row in enumerate(context.board_state.sign_map) for x, sign in enumerate(row) if sign]
            payload['moves'] = []
            payload['initialPlayer'] = context.to_play
        if allowed:
            for move in allowed:
                pos = point(move, context.board_state.size)
                if pos and context.board_state.sign_map[context.board_state.size - 1 - pos[0]][pos[1]]:
                    raise ValueError('该标记指向已有棋子，不能作为落点；可分析当前局面解释该棋子')
            payload['allowMoves'] = [{'player': context.to_play, 'moves': allowed, 'untilDepth': 1}]
        key = json.dumps([paths, payload, context.to_play], sort_keys=True)
        if key in self.cache:
            return self.cache[key].model_copy(update={'cached': True}, deep=True)
        response = await self.client.request(payload)
        # Engine reports BLACK; all business values use the current player's perspective.
        black = context.to_play == 'B'
        result = PositionAnalysis(score_lead=response.rootInfo.scoreLead * (1 if black else -1),
                                  winrate=response.rootInfo.winrate if black else 1 - response.rootInfo.winrate,
                                  visits=response.rootInfo.visits, perspective=context.to_play,
                                  candidates=[CandidateMove(coordinate=m.move, score_lead=m.scoreLead * (1 if black else -1),
                                                            winrate=m.winrate if black else 1 - m.winrate,
                                                            visits=m.visits, prior=m.prior, pv=m.pv)
                                              for m in sorted(response.moveInfos, key=lambda m: m.order)],
                                  ownership=response.ownership, policy=response.policy, human_policy=response.humanPolicy)
        if len(self.cache) >= 128:
            self.cache.pop(next(iter(self.cache)))
        self.cache[key] = result
        return result

    async def analyze_move(self, context: GameContext, coordinate: str) -> PositionAnalysis:
        result = await self.analyze_position(context, [coordinate])
        if not any(c.coordinate.lower() == coordinate.lower() for c in result.candidates):
            raise ValueError('KataGo 未返回该落点：可能是禁入点或劫争禁着')
        return result

    async def compare_moves(self, context: GameContext, coordinates: list[str]) -> list[PositionAnalysis]:
        return [await self.analyze_move(context, c) for c in coordinates]

    async def analyze_variation(self, context: GameContext, coordinate: str) -> tuple[PositionAnalysis, VariationPreview]:
        result = await self.analyze_move(context, coordinate)
        return result, self.preview(context, result.candidates[0].pv)

    def preview(self, context: GameContext, pv: list[str], limit: int = 5) -> VariationPreview:
        size = context.board_state.size
        board = boards.Board(size)
        black, white = set(), set()
        for y, row in enumerate(context.board_state.sign_map):
            for x, sign in enumerate(row):
                if sign:
                    (black if sign == 1 else white).add((size - 1 - y, x))
        board.apply_setup(black, white, set())
        color = context.to_play.lower()
        steps = []
        for i, move in enumerate(pv[:limit]):
            pos = point(move, size)
            if pos:
                if board.get(*pos):
                    break
                board.play(*pos, color)
            steps.append({'id': i + 1, 'coordinate': move, 'color': color.upper()})
            color = 'w' if color == 'b' else 'b'
        signs = [[{'b': 1, 'w': -1, None: 0}[board.get(size - 1 - y, x)] for x in range(size)] for y in range(size)]
        return VariationPreview(sign_map=signs, steps=steps)

    async def close(self) -> None:
        await self.client.close()
        self.cache.clear()
