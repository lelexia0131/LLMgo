from backend.domain.analysis import PositionAnalysis
from backend.domain.context import GameContext
from backend.domain.move import BoardMarker


def map_candidates(context: GameContext, result: PositionAnalysis) -> None:
    """Assign optional UI labels; the evidence retains all candidates regardless."""
    for i, candidate in enumerate(result.candidates[:3]):
        existing = next((m for m in context.markers if m.coordinate == candidate.coordinate), None)
        if existing:
            if i == 0:
                existing.role = 'best_move'
        elif len(context.markers) < 5:
            used = {m.id for m in context.markers}
            context.markers.append(BoardMarker(id=next(n for n in range(1, 6) if n not in used),
                                               coordinate=candidate.coordinate,
                                               role='best_move' if i == 0 else 'candidate'))
