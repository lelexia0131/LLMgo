from dataclasses import dataclass, field
from agents import function_tool, FunctionTool
from backend.domain.context import GameContext, GameSnapshot
from backend.domain.move import BoardMarker
from backend.domain.analysis import PositionAnalysis, VariationPreview
from backend.services.analysis_service import AnalysisService
from backend.evidence.builder import build_evidence
from backend.evidence.move_review_builder import build_move_review_evidence
from backend.services.review_service import ReviewService
from backend.services.reference_mapper import map_candidates


@dataclass
class TeachingContext:
    game: GameContext
    analysis: AnalysisService
    snapshot: GameSnapshot | None = None
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
                'nodes': [n.model_dump(include={'id', 'parent_id', 'move_number', 'move'}) for n in ctx.game.nodes],
                'board_state': ctx.game.board_state.model_dump(),
                'current_markers': [m.model_dump() for m in ctx.game.markers]}

    @function_tool
    async def analyze_current_position() -> dict:
        """调用 KataGo 分析全局、获取最佳候选；为未标记候选分配数字。"""
        ctx.calls.append('analyze_current_position')
        result = await ctx.analysis.analyze_position(ctx.game)
        map_candidates(ctx.game, result)
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

    @function_tool
    async def inspect_move(node_id: str | None = None) -> dict:
        """复盘一个已落子的节点；省略 node_id 表示提问时当前节点的实战着。

        按 get_game_context 的 nodes 选择节点，含实战着、落子前后评价、损失与 PV。
        返回数值统一为实战行棋方视角，候选外的实战着单独搜索且不推测排名。
        """
        if ctx.snapshot is None:
            raise ValueError('当前请求缺少棋谱快照，无法复盘历史落子')
        ctx.calls.append(f'inspect_move({node_id or ctx.game.node_id})')
        review = await ReviewService(ctx.analysis).inspect_move(ctx.snapshot, node_id)
        ctx.evidence_count += 1
        return build_move_review_evidence(review).model_dump()

    return [get_game_context, analyze_current_position, analyze_marker, compare_markers, analyze_variation, inspect_move]
