"""Strict notification contracts; derived content comes from the server only."""

from datetime import datetime
from typing import Annotated, Literal, Self
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

Version = Annotated[int, Field(ge=1, le=9007199254740991, strict=True)]
NotificationKind = Literal[
    "task_due_soon", "task_overdue", "feedback_stale", "project_deadline", "job_failed"
]
ObjectType = Literal["task", "feedback_item", "project", "job"]
NotificationStatus = Literal["unread", "read", "snoozed", "dismissed"]
Delivery = Literal["alerted", "quiet", "muted"]
NotificationTab = Literal["active", "snoozed", "dismissed"]
Actor = Literal["student", "system"]
EventAction = Literal[
    "created", "read", "snooze", "dismiss", "restore", "progress_note", "snooze_expired"
]


class Dto(BaseModel):
    model_config = ConfigDict(extra="forbid")

    @field_validator("*")
    @classmethod
    def unicode_complete(cls, value: object) -> object:
        if isinstance(value, str) and any(0xD800 <= ord(c) <= 0xDFFF for c in value):
            raise ValueError("必须使用完整 Unicode 字符。")
        return value


class Command(Dto):
    command_id: UUID
    expected_version: Version


class NotificationTransition(Command):
    action: Literal["read", "snooze", "dismiss", "restore"]
    snooze_until: datetime | None = None

    @model_validator(mode="after")
    def snooze_pair(self) -> Self:
        if (self.action == "snooze") != (self.snooze_until is not None):
            raise ValueError("只有延后需要且必须提供延后截止时间。")
        if self.snooze_until is not None and self.snooze_until.tzinfo is None:
            raise ValueError("延后截止时间必须包含时区。")
        return self


class ProgressNoteCreate(Command):
    # The student's own words are kept verbatim; only all-blank input is rejected.
    text: str = Field(min_length=1, max_length=2000, strict=True)

    @model_validator(mode="after")
    def nonblank(self) -> Self:
        if not self.text.strip():
            raise ValueError("请填写线下进展。")
        return self


class ObjectRef(Dto):
    type: ObjectType
    id: UUID
    parent_id: UUID | None
    source_version: int


class ProgressNote(Dto):
    text: str
    created_at: datetime


class NotificationRead(Dto):
    id: UUID
    project_id: UUID
    kind: NotificationKind
    object: ObjectRef
    dedupe_key: str
    title: str
    trigger: str
    basis: list[str]
    uncertainty: str
    status: NotificationStatus
    delivery: Delivery
    snooze_until: datetime | None
    progress_notes: list[ProgressNote]
    version: Version
    created_at: datetime
    updated_at: datetime


class NotificationPage(Dto):
    items: list[NotificationRead]
    total: int
    limit: int
    offset: int
    unread_count: int


class UnreadCount(Dto):
    project_id: UUID
    unread_count: int


class RefreshResult(Dto):
    project_id: UUID
    created: int
    woken: int
    unread_count: int


class NotificationEventRead(Dto):
    id: UUID
    notification_id: UUID
    notification_title: str
    object: ObjectRef
    version: Version
    action: EventAction
    actor: Actor
    from_status: NotificationStatus | None
    to_status: NotificationStatus
    snooze_until: datetime | None
    note: str
    created_at: datetime


class NotificationEventPage(Dto):
    items: list[NotificationEventRead]
    total: int
    limit: int
    offset: int


class ReminderSettingsRead(Dto):
    # version 0 means the defaults have not been saved yet.
    version: int
    enabled: bool
    cooldown_hours: int
    overdue_days: int
    updated_at: datetime | None


class ReminderSettingsUpdate(Dto):
    expected_version: int = Field(ge=0, le=2_147_483_646, strict=True)
    enabled: bool = Field(strict=True)
    cooldown_hours: int = Field(ge=1, le=168, strict=True)
    overdue_days: int = Field(ge=1, le=30, strict=True)
