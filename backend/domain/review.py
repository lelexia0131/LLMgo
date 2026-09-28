from typing import Literal
from pydantic import BaseModel
from backend.domain.analysis import CandidateMove
from backend.domain.move import Color


class Evaluation(BaseModel):
    score_lead: float
    winrate: float
    visits: int


class PositionReview(BaseModel):
    game_id: str
    node_id: str
    revision: int
    move_number: int
    to_play: Color
    root_evaluation: Evaluation
    candidate_moves: list[CandidateMove]


class MoveReview(BaseModel):
    game_id: str
    node_id: str
    parent_node_id: str
    revision: int
    move_number: int
    player: Color
    actual_move: str
    before: Evaluation
    after: Evaluation
    actual_move_analysis: CandidateMove
    best_move: str
    candidate_moves: list[CandidateMove]
    score_loss: float
    winrate_loss: float
    actual_move_status: Literal['best', 'top_candidate', 'searched_candidate', 'outside_returned_candidates']
    actual_move_rank: int | None
