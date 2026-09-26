from pydantic import BaseModel


class BoardState(BaseModel):
    size: int
    # Shudan's top-to-bottom row order; 1 = black, -1 = white.
    sign_map: list[list[int]]
    last_move: str | None = None
    move_numbers: list[list[int]]
