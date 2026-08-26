from pydantic import BaseModel, ConfigDict, Field


class AgentAddon(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)

    product_id: str = Field(min_length=1)
    qty: int = Field(ge=1, le=20)
    reasoning: str = Field(min_length=1, max_length=300)
    confidence: float | None = Field(default=None, ge=0, le=1)


class AgentProposal(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)

    addons: list[AgentAddon] = Field(default_factory=list, max_length=3)
    discount_pct: float = Field(default=0, ge=0, le=100)
    reasoning: str = Field(min_length=1, max_length=500)
    confidence: float | None = Field(default=None, ge=0, le=1)
    execution_metadata: dict = Field(default_factory=dict)