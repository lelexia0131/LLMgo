from pydantic import BaseModel, Field
from backend.domain.move import Move


class GameNode(BaseModel):
    id: str
    parent_id: str | None
    children: list[str] = Field(default_factory=list)
    move: Move | None = None
    comment: str = ''
    move_number: int = 0


class Game(BaseModel):
    id: str
    current_node: str
    nodes: list[GameNode]
    metadata: dict[str, str]
