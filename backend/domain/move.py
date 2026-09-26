from typing import Literal
from pydantic import BaseModel

Color = Literal['B', 'W']
LETTERS = 'ABCDEFGHJKLMNOPQRST'


def coordinate(row: int, col: int, size: int) -> str:
    if not (0 <= row < size and 0 <= col < size):
        raise ValueError('棋盘位置超出范围')
    return f'{LETTERS[col]}{row + 1}'


def point(value: str, size: int) -> tuple[int, int] | None:
    if value.lower() == 'pass':
        return None
    value = value.upper()
    try:
        col, row = LETTERS.index(value[0]), int(value[1:]) - 1
    except (ValueError, IndexError):
        raise ValueError('无效棋盘坐标') from None
    if not (0 <= row < size and 0 <= col < size):
        raise ValueError('棋盘位置超出范围')
    return row, col


class Move(BaseModel):
    color: Color
    coordinate: str


class BoardMarker(BaseModel):
    id: int
    coordinate: str
    role: Literal['best_move', 'candidate', 'selected_move', 'stone']
