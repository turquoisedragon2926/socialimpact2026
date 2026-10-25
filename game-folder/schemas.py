"""Validated application inputs, shared by HTTP and agent tools."""
from pydantic import BaseModel, Field
from typing import Literal

class EvaluationRequest(BaseModel):
    scene_ids: list[str] = Field(min_length=1, max_length=12)
    years: list[int] = Field(min_length=1, max_length=200)
    revisions: dict[str, int]

class ViewContext(BaseModel):
    scene_id: str | None = None
    comparison_ids: list[str] = Field(default_factory=list, max_length=12)
    selected_cells: list[str] = Field(default_factory=list, max_length=15000)
    year: int | None = None
    layer: str = 'cover'
    comparison_field: Literal['design','mean','stddev'] = 'design'
    bounds: list[float] | None = Field(default=None, min_length=4, max_length=4)

class AssistantRequest(BaseModel):
    message: str = Field(min_length=1, max_length=16000)
    conversation_id: str | None = None
    context: ViewContext = Field(default_factory=ViewContext)

class NewScene(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    lat: float = Field(ge=-60, le=80)
    lon: float = Field(ge=-179, le=179)
    year: int = Field(ge=2020, le=2021)
    place: str | None = None
    location_name: str = Field(default="Selected place", max_length=200)
    climate: str = "temperate_dry"
    bounds: list[float] | None = Field(default=None, min_length=4, max_length=4)

class ScenePatch(BaseModel):
    revision: int
    name: str | None = Field(default=None, min_length=1, max_length=100)
    selected_year: int | None = None
    climate: str | None = None

class Action(BaseModel):
    revision: int
    cell_ids: list[str] = Field(min_length=1, max_length=15000)
    cover: str
    year: int
    note: str = Field(default="", max_length=1000)

class Revision(BaseModel):
    revision: int

class Clone(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=100)

class Compare(BaseModel):
    scene_ids: list[str] = Field(min_length=2, max_length=12)
    year: int
