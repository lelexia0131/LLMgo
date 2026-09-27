from dataclasses import dataclass, field
from agents import function_tool, FunctionTool
from backend.domain.context import GameContext
from backend.domain.move import BoardMarker
from backend.domain.analysis import PositionAnalysis, VariationPreview
from backend.services.analysis_service import AnalysisService
from backend.evidence.builder import build_evidence


@dataclass
class TeachingContext:
    game: GameContext
    analysis: AnalysisService
    calls: list[str] = field(default_factory=list)
    evidence_count: int = 0
    preview: VariationPreview | None = None

    def marker(self, marker_id: int) -> BoardMarker:
        marker = next((m for m in self.game.markers if m.id == marker_id), None)
        if marker is None:
            raise ValueError('当前问题中不存在这个数字标记')
        return marker

    def evidence(self, result: PositionAnalysis) -> dict:
        self.evidence_count += 1
        return build_evidence(self.game, result).model_dump()


def create_tools(ctx: TeachingContext) -> list[FunctionTool]:
    @function_tool
    def get_game_context() -> dict:
        """获取当前局面与 current_markers；数字只在本问题的局面有效。"""
        ctx.calls.append('get_game_context')
        return {'game_id': ctx.game.game_id, 'node_id': ctx.game.node_id,
                'move_number': ctx.game.move_number, 'to_play': ctx.game.to_play,
                'move_history': [m.model_dump() for m in ctx.game.move_history],
                'metadata': ctx.game.metadata,
                'board_state': ctx.game.board_state.model_dump(),
                'current_markers': [m.model_dump() for m in ctx.game.markers]}

    @function_tool
    async def analyze_current_position() -> dict:
        """调用 KataGo 分析全局、获取最佳候选；为未标记候选分配数字。"""
        ctx.calls.append('analyze_current_position')
        result = await ctx.analysis.analyze_position(ctx.game)
        for i, candidate in enumerate(result.candidates[:3]):
            existing = next((m for m in ctx.game.markers if m.coordinate == candidate.coordinate), None)
            if existing:
                if i == 0:
                    existing.role = 'best_move'
            elif len(ctx.game.markers) < 5:
                ctx.game.markers.append(BoardMarker(id=len(ctx.game.markers) + 1,
                                                     coordinate=candidate.coordinate,
                                                     role='best_move' if i == 0 else 'candidate'))
        return {**ctx.evidence(result), 'current_markers': [m.model_dump() for m in ctx.game.markers]}

    @function_tool
    async def analyze_marker(marker_id: int) -> dict:
        """分析 KataGo 推荐数字对应的落点。"""
        ctx.calls.append(f'analyze_marker({marker_id})')
        marker = ctx.marker(marker_id)
        result = await ctx.analysis.analyze_move(ctx.game, marker.coordinate)
        return {**ctx.evidence(result), 'target_marker': marker.id, 'target_role': marker.role}

    @function_tool
    async def compare_markers(marker_ids: list[int]) -> list[dict]:
        """分别搜索并比较两个至五个候选标记，所有数值均以当前行棋方为视角。"""
        if not 2 <= len(set(marker_ids)) <= 5:
            raise ValueError('请选择 2 到 5 个不同标记')
        markers = [ctx.marker(i) for i in marker_ids]
        ctx.calls.append('compare_markers(' + ','.join(map(str, marker_ids)) + ')')
        return [ctx.evidence(r) for r in await ctx.analysis.compare_moves(ctx.game, [m.coordinate for m in markers])]

    @function_tool
    async def analyze_variation(marker_id: int) -> dict:
        """取得该候选的 KataGo PV，并把前五手以顺序数字显示在独立变化预览中。"""
        ctx.calls.append(f'analyze_variation({marker_id})')
        result, preview = await ctx.analysis.analyze_variation(ctx.game, ctx.marker(marker_id).coordinate)
        ctx.preview = preview
        return {**ctx.evidence(result), 'variation': preview.model_dump(),
                'numbering': '变化预览的数字是手顺，与原局面候选编号分开显示'}

    return [get_game_context, analyze_current_position, analyze_marker, compare_markers, analyze_variation]
