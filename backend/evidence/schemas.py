from uuid import uuid4
from pydantic import BaseModel, Field
from backend.domain.review import MoveReview


class CandidateEvidence(BaseModel):
    marker: int | None
    coordinate: str
    score_lead: float
    winrate: float
    visits: int
    prior: float
    pv: list[str]
    order: int | None


class PositionEvidence(BaseModel):
    evidence_id: str = Field(default_factory=lambda: uuid4().hex)
    game_id: str
    node_id: str
    revision: int
    move_number: int
    perspective: str
    score_lead: float
    winrate: float
    visits: int
    best_move: str | None
    best_marker: int | None
    candidates: list[CandidateEvidence]
    allowed_moves: list[str]
    source: str = 'KataGo'


class MoveReviewEvidence(MoveReview):
    evidence_id: str = Field(default_factory=lambda: uuid4().hex)
    source: str = 'KataGo'
    perspective: str
    loss_basis: str = '落子前同一局面中，首选与实战着的候选评价之差；before/after 为独立局面搜索。'
