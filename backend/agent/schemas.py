from pydantic import BaseModel
from backend.domain.move import BoardMarker
from backend.domain.analysis import VariationPreview


class TeacherAnswer(BaseModel):
    conclusion: str
    reasons: str
    key_variation: str
    principle: str
    referenced_markers: list[int]


class AgentReply(BaseModel):
    answer: TeacherAnswer
    current_markers: list[BoardMarker]
    tool_calls: list[str]
    preview: VariationPreview | None = None
