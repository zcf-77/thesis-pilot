import hashlib
import secrets
from datetime import UTC, datetime, timedelta
from uuid import UUID, uuid4

from sqlalchemy import delete, or_, select, update
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.dialects.sqlite import insert as sqlite_insert
from sqlalchemy.orm import Session

from thesis_pilot.core.errors import AppError
from thesis_pilot.modules.workspace.models import WorkspaceProfile, WorkspaceSession
from thesis_pilot.modules.workspace.schemas import ProfileRead, ProfileUpdate, SessionRead


def token_digest(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def session_required() -> AppError:
    return AppError("WORKSPACE_SESSION_REQUIRED", "请重新进入工作区。", 401)


def create_session(
    session: Session, *, seconds: int, previous_token: str | None = None
) -> tuple[str, SessionRead]:
    now = datetime.now(UTC)
    token = secrets.token_urlsafe(32)
    with session.begin():
        insert = sqlite_insert if session.get_bind().dialect.name == "sqlite" else pg_insert
        session.execute(
            insert(WorkspaceProfile)
            .values(id=uuid4(), singleton=1, created_at=now, updated_at=now)
            .on_conflict_do_nothing(index_elements=["singleton"])
        )
        profile = session.scalars(
            select(WorkspaceProfile).where(WorkspaceProfile.singleton == 1)
        ).one()
        if previous_token:
            session.execute(
                update(WorkspaceSession)
                .where(WorkspaceSession.token_hash == token_digest(previous_token))
                .values(revoked_at=now)
            )
        session.execute(
            delete(WorkspaceSession).where(
                or_(WorkspaceSession.expires_at <= now, WorkspaceSession.revoked_at.is_not(None))
            )
        )
        expires_at = now + timedelta(seconds=seconds)
        session.add(
            WorkspaceSession(
                token_hash=token_digest(token),
                workspace_id=profile.id,
                created_at=now,
                expires_at=expires_at,
            )
        )
        result = SessionRead(
            workspace_id=profile.id,
            expires_at=expires_at,
            profile=ProfileRead.model_validate(profile),
        )
    return token, result


def read_session(session: Session, token: str | None) -> SessionRead:
    if not token or len(token) > 256:
        raise session_required()
    with session.begin():
        record = session.scalar(
            select(WorkspaceSession).where(
                WorkspaceSession.token_hash == token_digest(token),
                WorkspaceSession.revoked_at.is_(None),
                WorkspaceSession.expires_at > datetime.now(UTC),
            )
        )
        if record is None:
            raise session_required()
        profile = session.get(WorkspaceProfile, record.workspace_id)
        if profile is None:
            raise session_required()
        return SessionRead(
            workspace_id=record.workspace_id,
            expires_at=record.expires_at,
            profile=ProfileRead.model_validate(profile),
        )


def revoke_session(session: Session, token: str | None) -> None:
    if not token or len(token) > 256:
        return
    with session.begin():
        session.execute(
            update(WorkspaceSession)
            .where(
                WorkspaceSession.token_hash == token_digest(token),
                WorkspaceSession.revoked_at.is_(None),
            )
            .values(revoked_at=datetime.now(UTC))
        )


def update_profile(session: Session, workspace_id: UUID, data: ProfileUpdate) -> ProfileRead:
    with session.begin():
        profile = session.scalars(
            update(WorkspaceProfile)
            .where(
                WorkspaceProfile.id == workspace_id,
                WorkspaceProfile.version == data.expected_version,
            )
            .values(
                **data.model_dump(exclude={"expected_version"}),
                version=WorkspaceProfile.version + 1,
                updated_at=datetime.now(UTC),
            )
            .returning(WorkspaceProfile)
            .execution_options(synchronize_session=False, populate_existing=True)
        ).one_or_none()
        if profile is None:
            raise AppError("WORKSPACE_PROFILE_CONFLICT", "资料已更新，请重新读取后再保存。", 409)
        return ProfileRead.model_validate(profile)
