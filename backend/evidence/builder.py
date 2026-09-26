from backend.domain.context import GameContext
from backend.domain.analysis import PositionAnalysis
from backend.evidence.schemas import CandidateEvidence, PositionEvidence


def build_evidence(context: GameContext, result: PositionAnalysis) -> PositionEvidence:
    ids = {m.coordinate: m.id for m in context.markers}
    candidates = [CandidateEvidence(marker=ids[c.coordinate], coordinate=c.coordinate,
                                    score_lead=round(c.score_lead, 2), winrate=round(c.winrate, 4), visits=c.visits)
                  for c in result.candidates if c.coordinate in ids]
    return PositionEvidence(move_number=context.move_number, perspective=result.perspective,
                            score_lead=round(result.score_lead, 2), winrate=round(result.winrate, 4),
                            best_marker=next((m.id for m in context.markers if m.role == 'best_move'), None),
                            candidates=candidates)
