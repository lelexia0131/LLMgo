from pydantic import BaseModel


class CandidateEvidence(BaseModel):
    marker: int
    coordinate: str
    score_lead: float
    winrate: float
    visits: int


class PositionEvidence(BaseModel):
    move_number: int
    perspective: str
    score_lead: float
    winrate: float
    best_marker: int | None
    candidates: list[CandidateEvidence]
    source: str = 'KataGo'
