from backend.domain.context import GameContext
from backend.domain.analysis import PositionAnalysis
from backend.evidence.schemas import CandidateEvidence, PositionEvidence


def build_evidence(context: GameContext, result: PositionAnalysis) -> PositionEvidence:
    ids = {m.coordinate: m.id for m in context.markers}
    candidates = [CandidateEvidence(marker=ids.get(c.coordinate), coordinate=c.coordinate,
                                    score_lead=round(c.score_lead, 2), winrate=round(c.winrate, 4), visits=c.visits,
                                    prior=c.prior, pv=c.pv, order=c.order)
                  for c in result.candidates]
    best = result.candidates[0].coordinate if result.candidates else None
    return PositionEvidence(game_id=context.game_id, node_id=context.node_id, revision=context.revision,
                            move_number=context.move_number, perspective=result.perspective,
                            score_lead=round(result.score_lead, 2), winrate=round(result.winrate, 4),
                            visits=result.visits, best_move=best, best_marker=ids.get(best),
                            candidates=candidates, allowed_moves=result.allowed_moves)
