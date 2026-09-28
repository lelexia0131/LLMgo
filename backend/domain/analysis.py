from pydantic import BaseModel, Field
from backend.domain.move import Color


class CandidateMove(BaseModel):
    coordinate: str
    score_lead: float
    winrate: float
    visits: int
    prior: float
    pv: list[str]
    order: int | None = None


class PositionAnalysis(BaseModel):
    score_lead: float
    winrate: float
    visits: int
    perspective: Color
    candidates: list[CandidateMove]
    allowed_moves: list[str] = Field(default_factory=list)
    ownership: list[float] | None = None
    policy: list[float] | None = None
    human_policy: list[float] | None = None
    cached: bool = False


class VariationPreview(BaseModel):
    sign_map: list[list[int]]
    steps: list[dict[str, str | int]] = Field(default_factory=list)
