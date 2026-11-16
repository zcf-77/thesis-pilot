"""Job contracts for feedback decomposition; imported by jobs.schemas, so no jobs imports here."""

from typing import Annotated, Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator

FEEDBACK_SPLIT_KIND = "feedback_decomposition"


def _exact_schema_version(value: object) -> object:
    if type(value) is not int:
        raise ValueError("结构版本必须为整数。")
    return value


class FeedbackSplitInput(BaseModel):
    """The frozen split run owns the batch original and configuration versions."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    schema_version: Literal[1] = 1
    split_id: UUID

    @field_validator("schema_version", mode="before")
    @classmethod
    def exact_schema_version(cls, value: object) -> object:
        return _exact_schema_version(value)


class FeedbackSplitResult(BaseModel):
    """Only references and counts; immutable suggestions live in the feedback_splits module."""

    model_config = ConfigDict(extra="forbid", strict=True)

    kind: Literal["feedback_decomposition"]
    schema_version: Literal[1]
    job_id: Annotated[UUID, Field(strict=False)]
    project_id: Annotated[UUID, Field(strict=False)]
    split_id: Annotated[UUID, Field(strict=False)]
    batch_id: Annotated[UUID, Field(strict=False)]
    suggestion_count: Annotated[int, Field(ge=0, le=50)]
    requested_model: Annotated[str, Field(min_length=1, max_length=200)]
    response_model: Annotated[str, Field(min_length=1, max_length=200)]
    # The model's overall remark (e.g. nothing decomposable); data, never instructions.
    note: Annotated[str, Field(max_length=2000)]
    model_used: Literal[True]
    writes_performed: Literal[False]

    @field_validator("job_id", "project_id", "split_id", "batch_id", mode="before")
    @classmethod
    def require_uuid_string(cls, value: object) -> object:
        if not isinstance(value, str | UUID):
            raise ValueError("标识必须为 UUID 字符串。")
        return value

    @field_validator("schema_version", mode="before")
    @classmethod
    def exact_schema_version(cls, value: object) -> object:
        return _exact_schema_version(value)
