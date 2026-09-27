from pydantic import BaseModel, Field
from backend.domain.board import BoardState
from backend.domain.game import GameNode
from backend.domain.move import BoardMarker, Color, Move


class GameContext(BaseModel):
    game_id: str
    node_id: str
    revision: int
    move_number: int
    to_play: Color
    move_history: list[Move]
    initial_stones: list[Move]
    initial_player: Color
    board_state: BoardState
    markers: list[BoardMarker] = Field(default_factory=list)
    metadata: dict[str, str]
    nodes: list[GameNode]
    comment: str
    filename: str | None = None
    can_undo: bool = False
    can_redo: bool = False
    move_losses: dict[str, float] = Field(default_factory=dict)
