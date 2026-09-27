from typing import Literal
from pydantic import BaseModel, Field


class OpenGame(BaseModel):
    path: str


class SaveGame(BaseModel):
    path: str | None = None


class Navigate(BaseModel):
    direction: Literal['first', 'previous', 'next', 'last', 'node']
    node_id: str | None = None


class Revision(BaseModel):
    revision: int


class PlayMove(Revision):
    coordinate: str


class EditGame(Revision):
    action: Literal['undo', 'redo', 'deleteNode', 'deleteBranch']


class Comment(Revision):
    text: str


class MarkerRequest(Revision):
    marker_id: int


class PreviewRequest(MarkerRequest):
    full: bool = False


class AskRequest(Revision):
    question: str = Field(min_length=1, max_length=4000)


class Credential(BaseModel):
    api_key: str = Field(max_length=1024)
