from pydantic import BaseModel, ConfigDict, Field


class MoveInfo(BaseModel):
    model_config = ConfigDict(extra='ignore')
    move: str
    scoreLead: float
    winrate: float = Field(ge=0, le=1)
    visits: int = Field(ge=0)
    prior: float = Field(ge=0, le=1)
    pv: list[str]
    order: int | None = None


class RootInfo(BaseModel):
    scoreLead: float
    winrate: float = Field(ge=0, le=1)
    visits: int = Field(ge=0)


class AnalysisResponse(BaseModel):
    model_config = ConfigDict(extra='ignore')
    id: str
    isDuringSearch: bool = False
    moveInfos: list[MoveInfo]
    rootInfo: RootInfo
    ownership: list[float] | None = None
    policy: list[float] | None = None
    humanPolicy: list[float] | None = None
