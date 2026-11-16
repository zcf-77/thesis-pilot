"""Literature search runs and project literature entries.

Searches are background jobs over a frozen run; the snapshot is written once with the
job's terminal state. Entries are saved only from a stored snapshot item, so the client
cannot inject bibliographic fields. DOI back-checks run outside database transactions
and are committed with a version CAS.
"""

import json
from datetime import UTC, datetime
from hashlib import sha256
from typing import cast
from uuid import UUID

from pydantic import ValidationError
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from thesis_pilot.core.errors import AppError
from thesis_pilot.modules.jobs.models import Job, OutboxEvent
from thesis_pilot.modules.jobs.schemas import JobRead, JobStatus
from thesis_pilot.modules.literature import sources
from thesis_pilot.modules.literature.contracts import (
    ADAPTER_VERSION,
    LITERATURE_JOB_KIND,
    LiteratureSearchInput,
    LiteratureSource,
)
from thesis_pilot.modules.literature.models import (
    LiteratureEntry,
    LiteratureEntryVersion,
    LiteratureSearch,
    LiteratureSearchSnapshot,
)
from thesis_pilot.modules.literature.schemas import (
    LiteratureEntryCommand,
    LiteratureEntryCreate,
    LiteratureEntryPage,
    LiteratureEntryRead,
    LiteratureEntryVersionPage,
    LiteratureEntryVersionRead,
    LiteratureResultItem,
    LiteratureSearchCreate,
    LiteratureSearchPage,
    LiteratureSearchRead,
    LiteratureSearchReceipt,
    LiteratureSearchRetry,
    LiteratureSnapshotRead,
    LiteratureVerificationDetail,
    Verification,
)
from thesis_pilot.modules.literature.sources import LiteratureRecord, SourceError
from thesis_pilot.modules.projects.models import Project

ACTIVE = ("queued", "running")


def error(code: str, message: str, status: int = 409) -> AppError:
    return AppError("LITERATURE_" + code, message, status)


def _utc(value: datetime) -> datetime:
    return value.replace(tzinfo=UTC) if value.tzinfo is None else value.astimezone(UTC)


def _now() -> datetime:
    return datetime.now(UTC)


def _hash(operation: str, project_id: UUID, payload: object) -> str:
    return sha256(
        json.dumps(
            {"operation": operation, "project_id": str(project_id), "input": payload},
            sort_keys=True,
            separators=(",", ":"),
            ensure_ascii=False,
        ).encode()
    ).hexdigest()


def _require_project(session: Session, project_id: UUID, *, lock: bool = False) -> None:
    query = select(Project.id).where(Project.id == project_id)
    if session.scalar(query.with_for_update() if lock else query) is None:
        raise AppError("PROJECT_NOT_FOUND", "项目不存在。", 404)


# --- Search runs -------------------------------------------------------------------


def search_params(search: LiteratureSearch) -> dict[str, object]:
    return {
        "query": search.query,
        "source": search.source,
        "year_from": search.year_from,
        "year_to": search.year_to,
        "rows": search.row_limit,
    }


def job_digest(search: LiteratureSearch, source_job_id: UUID | None) -> str:
    return sha256(
        json.dumps(
            {
                "kind": LITERATURE_JOB_KIND,
                "project_id": str(search.project_id),
                "search_id": str(search.id),
                "adapter_version": ADAPTER_VERSION,
                "params": search_params(search),
                "source_job_id": str(source_job_id) if source_job_id else None,
            },
            sort_keys=True,
            separators=(",", ":"),
            ensure_ascii=False,
        ).encode()
    ).hexdigest()


def _job(session: Session, search: LiteratureSearch) -> Job:
    job = session.get(Job, search.job_id) if search.job_id else None
    if job is None or job.project_id != search.project_id or job.kind != LITERATURE_JOB_KIND:
        raise error("SEARCH_INVALID", "检索记录与执行任务不一致。")
    return job


def _search(session: Session, project_id: UUID, search_id: UUID) -> LiteratureSearch:
    found = session.scalar(
        select(LiteratureSearch).where(
            LiteratureSearch.id == search_id, LiteratureSearch.project_id == project_id
        )
    )
    if found is None:
        raise error("SEARCH_NOT_FOUND", "项目中没有该检索记录。", 404)
    return found


def _saved_keys(session: Session, project_id: UUID, keys: list[str]) -> dict[str, UUID]:
    if not keys:
        return {}
    rows = session.execute(
        select(LiteratureEntry.dedupe_key, LiteratureEntry.id).where(
            LiteratureEntry.project_id == project_id,
            LiteratureEntry.dedupe_key.in_(keys),
            LiteratureEntry.removed.is_(False),
        )
    ).all()
    return {key: entry_id for key, entry_id in rows}


def dedupe_key(record: LiteratureRecord) -> str:
    """DOI first; without a DOI fall back to the normalized title and year."""
    if record.doi:
        return "doi:" + record.doi
    digest = sha256(f"{sources.comparable_title(record.title)}|{record.year}".encode()).hexdigest()
    return "title:" + digest


def _snapshot_read(
    session: Session, project_id: UUID, snapshot: LiteratureSearchSnapshot
) -> LiteratureSnapshotRead:
    records = [LiteratureRecord.model_validate(item) for item in snapshot.items]
    saved = _saved_keys(session, project_id, [dedupe_key(record) for record in records])
    return LiteratureSnapshotRead(
        id=snapshot.id,
        source=cast(LiteratureSource, snapshot.source),
        adapter_version=snapshot.adapter_version,
        response_sha256=snapshot.response_sha256,
        total_results=snapshot.total_results,
        skipped_count=snapshot.skipped_count,
        retrieved_at=snapshot.retrieved_at,
        items=[
            LiteratureResultItem(
                **record.model_dump(), index=index, saved_entry_id=saved.get(dedupe_key(record))
            )
            for index, record in enumerate(records)
        ],
    )


def _read(session: Session, search: LiteratureSearch) -> LiteratureSearchRead:
    job = _job(session, search)
    snapshot = (
        session.scalar(
            select(LiteratureSearchSnapshot).where(LiteratureSearchSnapshot.search_id == search.id)
        )
        if job.status == "succeeded"
        else None
    )
    return LiteratureSearchRead(
        id=search.id,
        project_id=search.project_id,
        job_id=job.id,
        status=cast(JobStatus, job.status),
        attempt=job.attempt,
        error_code=job.error_code,
        query=search.query,
        source=cast(LiteratureSource, search.source),
        year_from=search.year_from,
        year_to=search.year_to,
        rows=search.row_limit,
        source_search_id=search.source_search_id,
        snapshot=_snapshot_read(session, search.project_id, snapshot) if snapshot else None,
        created_at=search.created_at,
        updated_at=_utc(job.updated_at),
    )


def _receipt(session: Session, search: LiteratureSearch) -> LiteratureSearchReceipt:
    return LiteratureSearchReceipt(
        search=_read(session, search), job=JobRead.model_validate(_job(session, search))
    )


def _assert_idle(session: Session, project_id: UUID) -> None:
    active = session.scalar(
        select(LiteratureSearch.id)
        .join(Job, Job.id == LiteratureSearch.job_id)
        .where(LiteratureSearch.project_id == project_id, Job.status.in_(ACTIVE))
        .limit(1)
    )
    if active is not None:
        raise error("SEARCH_BUSY", "已有文献检索在运行，请等待完成或取消后再检索。")


def _previous(
    session: Session, project_id: UUID, command_id: UUID, digest: str
) -> LiteratureSearch | None:
    search = session.scalar(
        select(LiteratureSearch).where(LiteratureSearch.command_id == command_id)
    )
    if search is None:
        return None
    if search.project_id != project_id or search.request_hash != digest:
        raise error("COMMAND_CONFLICT", "检索命令已用于不同请求，请核对原检索记录。")
    return search


def _new_search(
    session: Session,
    project_id: UUID,
    params: dict[str, object],
    command_id: UUID,
    digest: str,
    source_search_id: UUID | None = None,
    source_job_id: UUID | None = None,
) -> LiteratureSearch:
    search = LiteratureSearch(
        project_id=project_id,
        command_id=command_id,
        request_hash=digest,
        query=cast(str, params["query"]),
        source=cast(str, params["source"]),
        year_from=cast(int | None, params["year_from"]),
        year_to=cast(int | None, params["year_to"]),
        row_limit=cast(int, params["rows"]),
        source_search_id=source_search_id,
    )
    session.add(search)
    session.flush()
    fixed = LiteratureSearchInput(search_id=search.id).model_dump(mode="json")
    job = Job(
        project_id=project_id,
        kind=LITERATURE_JOB_KIND,
        idempotency_key="literature:" + str(command_id),
        request_hash=job_digest(search, source_job_id),
        input_snapshot=fixed,
        resource_scope=dict(fixed),
        configuration=None,
        source_job_id=source_job_id,
    )
    session.add(job)
    session.flush()
    session.add(OutboxEvent(job_id=job.id))
    search.job_id = job.id
    session.flush()
    return search


def _submit(
    session: Session,
    project_id: UUID,
    command_id: UUID,
    digest: str,
    create: "SearchFactory",
) -> LiteratureSearchReceipt:
    try:
        with session.begin():
            previous = _previous(session, project_id, command_id, digest)
            if previous is not None:
                return _receipt(session, previous)
            # Serializes search creation per project so only one search runs at a time.
            _require_project(session, project_id, lock=True)
            previous = _previous(session, project_id, command_id, digest)
            if previous is not None:
                return _receipt(session, previous)
            return _receipt(session, create(session))
    except IntegrityError:
        with session.begin():
            previous = _previous(session, project_id, command_id, digest)
            if previous is not None:
                return _receipt(session, previous)
        raise


class SearchFactory:
    def __init__(
        self,
        project_id: UUID,
        command_id: UUID,
        digest: str,
        params: dict[str, object] | None = None,
        retry_of: UUID | None = None,
    ) -> None:
        self.project_id = project_id
        self.command_id = command_id
        self.digest = digest
        self.params = params
        self.retry_of = retry_of

    def __call__(self, session: Session) -> LiteratureSearch:
        if self.retry_of is None:
            _assert_idle(session, self.project_id)
            assert self.params is not None
            return _new_search(session, self.project_id, self.params, self.command_id, self.digest)
        original = _search(session, self.project_id, self.retry_of)
        old_job = _job(session, original)
        if old_job.status not in {"failed", "cancelled"}:
            raise error("RETRY_INVALID", "只能重试失败或已取消的检索。")
        _assert_idle(session, self.project_id)
        return _new_search(
            session,
            self.project_id,
            search_params(original),
            self.command_id,
            self.digest,
            original.id,
            old_job.id,
        )


def create_search(
    session: Session, project_id: UUID, data: LiteratureSearchCreate
) -> LiteratureSearchReceipt:
    params = data.model_dump(mode="json", exclude={"command_id"})
    digest = _hash("search", project_id, params)
    factory = SearchFactory(project_id, data.command_id, digest, params=params)
    return _submit(session, project_id, data.command_id, digest, factory)


def retry_search(
    session: Session, project_id: UUID, search_id: UUID, data: LiteratureSearchRetry
) -> LiteratureSearchReceipt:
    digest = _hash("retry", project_id, {"search_id": str(search_id)})
    factory = SearchFactory(project_id, data.command_id, digest, retry_of=search_id)
    return _submit(session, project_id, data.command_id, digest, factory)


def list_searches(
    session: Session, project_id: UUID, *, limit: int, offset: int
) -> LiteratureSearchPage:
    with session.begin():
        _require_project(session, project_id)
        rows = session.scalars(
            select(LiteratureSearch)
            .where(LiteratureSearch.project_id == project_id)
            .order_by(LiteratureSearch.created_at.desc(), LiteratureSearch.id.desc())
            .limit(limit)
            .offset(offset)
        ).all()
        total = session.scalar(
            select(func.count())
            .select_from(LiteratureSearch)
            .where(LiteratureSearch.project_id == project_id)
        )
        return LiteratureSearchPage(
            items=[_read(session, row) for row in rows],
            total=total or 0,
            limit=limit,
            offset=offset,
        )


def get_search(session: Session, project_id: UUID, search_id: UUID) -> LiteratureSearchRead:
    with session.begin():
        return _read(session, _search(session, project_id, search_id))


def cancel_search(session: Session, project_id: UUID, search_id: UUID) -> LiteratureSearchRead:
    from thesis_pilot.modules.jobs.service import cancel_job

    with session.begin():
        job_id = _job(session, _search(session, project_id, search_id)).id
    cancel_job(session, job_id, include_diagnostic=False, project_id=project_id)
    return get_search(session, project_id, search_id)


# --- Worker hooks (called by literature.jobs under the job's run token) ------------


def search_for_job(session: Session, job: Job) -> LiteratureSearch:
    try:
        fixed = LiteratureSearchInput.model_validate(job.input_snapshot)
    except ValidationError:
        raise AppError("JOB_INPUT_INVALID", "检索任务固定输入无效。", 422) from None
    search = session.get(LiteratureSearch, fixed.search_id)
    if (
        job.kind != LITERATURE_JOB_KIND
        or search is None
        or search.project_id != job.project_id
        or search.job_id != job.id
        or job.configuration is not None
        or job.resource_scope != fixed.model_dump(mode="json")
        or job.request_hash != job_digest(search, job.source_job_id)
    ):
        raise AppError("JOB_INPUT_INVALID", "检索任务与固定检索记录不一致。", 422)
    return search


def store_snapshot_in_transaction(
    session: Session,
    job: Job,
    search: LiteratureSearch,
    response: sources.SearchResponse,
    retrieved_at: datetime,
) -> LiteratureSearchSnapshot:
    if len(response.items) > search.row_limit:
        raise AppError("JOB_RESULT_INVALID", "检索结果超出固定条数。", 422)
    snapshot = LiteratureSearchSnapshot(
        search_id=search.id,
        project_id=search.project_id,
        job_id=job.id,
        source=search.source,
        adapter_version=ADAPTER_VERSION,
        response_sha256=response.response_sha256,
        total_results=response.total_results,
        skipped_count=response.skipped_count,
        items=[item.model_dump(mode="json") for item in response.items],
        retrieved_at=retrieved_at,
    )
    session.add(snapshot)
    session.flush()
    return snapshot


# --- Entries -------------------------------------------------------------------------


def verify_record(record: LiteratureRecord) -> tuple[Verification, LiteratureVerificationDetail]:
    """Network back-check. Never call inside a database transaction."""
    if not record.doi:
        return "unverified", LiteratureVerificationDetail(checked=False, reason="no_doi")
    try:
        found = sources.lookup_doi(record.doi)
    except SourceError as failure:
        return "unverified", LiteratureVerificationDetail(
            checked=False, reason="lookup_failed", error_code=failure.code
        )
    if not found.found:
        return "not_found", LiteratureVerificationDetail(checked=True, reason="doi_not_found")

    def detail(reason: str) -> LiteratureVerificationDetail:
        return LiteratureVerificationDetail.model_validate(
            {
                "checked": True,
                "reason": reason,
                "registry_title": found.title,
                "registry_year": found.year,
            }
        )

    if found.title is None or sources.comparable_title(found.title) != sources.comparable_title(
        record.title
    ):
        return "conflict", detail("title_mismatch")
    if record.year is not None and found.year is not None and record.year != found.year:
        return "conflict", detail("year_mismatch")
    return "verified", detail("match")


def _entry(
    session: Session, project_id: UUID, entry_id: UUID, *, lock: bool = False
) -> LiteratureEntry:
    query = select(LiteratureEntry).where(
        LiteratureEntry.id == entry_id, LiteratureEntry.project_id == project_id
    )
    found = session.scalar(query.with_for_update() if lock else query)
    if found is None:
        raise error("ENTRY_NOT_FOUND", "项目中没有该文献条目。", 404)
    return found


def _entry_read(session: Session, entry: LiteratureEntry) -> LiteratureEntryRead:
    retrieved_at = session.scalar(
        select(LiteratureSearchSnapshot.retrieved_at).where(
            LiteratureSearchSnapshot.id == entry.snapshot_id
        )
    )
    if retrieved_at is None:
        raise error("ENTRY_INVALID", "文献条目缺少来源快照。")
    return LiteratureEntryRead(
        id=entry.id,
        project_id=entry.project_id,
        version=entry.version,
        removed=entry.removed,
        search_id=entry.search_id,
        snapshot_id=entry.snapshot_id,
        result_index=entry.result_index,
        record=LiteratureRecord.model_validate(entry.record),
        verification=cast(Verification, entry.verification),
        verification_detail=LiteratureVerificationDetail.model_validate(entry.verification_detail),
        verified_at=entry.verified_at,
        retrieved_at=retrieved_at,
        created_at=entry.created_at,
        updated_at=entry.updated_at,
    )


def _snapshot_item(
    session: Session, project_id: UUID, search_id: UUID, index: int
) -> tuple[LiteratureSearchSnapshot, LiteratureRecord]:
    search = _search(session, project_id, search_id)
    snapshot = session.scalar(
        select(LiteratureSearchSnapshot).where(LiteratureSearchSnapshot.search_id == search.id)
    )
    if snapshot is None or _job(session, search).status != "succeeded":
        raise error("SEARCH_NOT_READY", "检索尚未完成，暂无可保存的结果。")
    if not 0 <= index < len(snapshot.items):
        raise error("RESULT_NOT_FOUND", "检索结果中没有该条目。", 404)
    return snapshot, LiteratureRecord.model_validate(snapshot.items[index])


def _existing_save(
    session: Session, project_id: UUID, data: LiteratureEntryCreate
) -> LiteratureEntry | None:
    entry = session.scalar(
        select(LiteratureEntry).where(LiteratureEntry.command_id == data.command_id)
    )
    if entry is None:
        return None
    if (
        entry.project_id != project_id
        or entry.search_id != data.search_id
        or entry.result_index != data.result_index
    ):
        raise error("COMMAND_CONFLICT", "保存命令已用于不同文献，请核对原条目。")
    return entry


def _assert_unique(session: Session, project_id: UUID, key: str) -> None:
    existing = session.scalar(
        select(LiteratureEntry).where(
            LiteratureEntry.project_id == project_id, LiteratureEntry.dedupe_key == key
        )
    )
    if existing is None:
        return
    if existing.removed:
        raise error("ENTRY_REMOVED_DUPLICATE", "这篇文献已移出项目文献，可在已移除条目中恢复。")
    raise error("ENTRY_DUPLICATE", "这篇文献已保存在项目文献中。")


def save_entry(
    session: Session, project_id: UUID, data: LiteratureEntryCreate
) -> LiteratureEntryRead:
    with session.begin():
        _require_project(session, project_id)
        previous = _existing_save(session, project_id, data)
        if previous is not None:
            return _entry_read(session, previous)
        snapshot, record = _snapshot_item(session, project_id, data.search_id, data.result_index)
        key = dedupe_key(record)
        _assert_unique(session, project_id, key)
    verification, detail = verify_record(record)
    checked_at = _now()
    try:
        with session.begin():
            previous = _existing_save(session, project_id, data)
            if previous is not None:
                return _entry_read(session, previous)
            _require_project(session, project_id, lock=True)
            _assert_unique(session, project_id, key)
            entry = LiteratureEntry(
                project_id=project_id,
                command_id=data.command_id,
                dedupe_key=key,
                search_id=data.search_id,
                snapshot_id=snapshot.id,
                result_index=data.result_index,
                record=record.model_dump(mode="json"),
                doi=record.doi,
                title=record.title,
                coverage=record.coverage,
                verification=verification,
                verification_detail=detail.model_dump(mode="json"),
                verified_at=checked_at if detail.checked else None,
                removed=False,
                version=1,
                created_at=checked_at,
                updated_at=checked_at,
            )
            session.add(entry)
            session.flush()
            _append_version(session, entry, "saved", None, checked_at)
            return _entry_read(session, entry)
    except IntegrityError:
        with session.begin():
            previous = _existing_save(session, project_id, data)
            if previous is not None:
                return _entry_read(session, previous)
            _assert_unique(session, project_id, key)
        raise


def _append_version(
    session: Session,
    entry: LiteratureEntry,
    action: str,
    command_id: UUID | None,
    instant: datetime,
) -> None:
    session.add(
        LiteratureEntryVersion(
            entry_id=entry.id,
            project_id=entry.project_id,
            version=entry.version,
            action=action,
            removed=entry.removed,
            verification=entry.verification,
            verification_detail=entry.verification_detail,
            command_id=command_id,
            created_at=instant,
        )
    )
    session.flush()


def _replayed(session: Session, entry: LiteratureEntry, command_id: UUID, action: str) -> bool:
    version = session.scalar(
        select(LiteratureEntryVersion).where(LiteratureEntryVersion.command_id == command_id)
    )
    if version is None:
        return False
    if version.entry_id != entry.id or version.action != action:
        raise error("COMMAND_CONFLICT", "该命令已用于其他文献操作。")
    return True


def _change(
    session: Session,
    project_id: UUID,
    entry_id: UUID,
    data: LiteratureEntryCommand,
    action: str,
    apply: "EntryChange",
) -> LiteratureEntryRead:
    try:
        with session.begin():
            entry = _entry(session, project_id, entry_id, lock=True)
            if _replayed(session, entry, data.command_id, action):
                return _entry_read(session, entry)
            if entry.version != data.expected_version:
                raise error("ENTRY_VERSION_CONFLICT", "文献条目已变化，请刷新后再操作。")
            instant = _now()
            apply(entry, instant)
            entry.version += 1
            entry.updated_at = instant
            session.flush()
            _append_version(session, entry, action, data.command_id, instant)
            return _entry_read(session, entry)
    except IntegrityError:
        with session.begin():
            entry = _entry(session, project_id, entry_id)
            if _replayed(session, entry, data.command_id, action):
                return _entry_read(session, entry)
        raise


class EntryChange:
    def __init__(
        self,
        removed: bool | None = None,
        verification: tuple[Verification, LiteratureVerificationDetail] | None = None,
    ) -> None:
        self.removed = removed
        self.verification = verification

    def __call__(self, entry: LiteratureEntry, instant: datetime) -> None:
        if self.removed is not None:
            if entry.removed == self.removed:
                raise error(
                    "ENTRY_STATE_CONFLICT",
                    "文献条目已移出项目文献。" if self.removed else "文献条目没有被移除。",
                )
            entry.removed = self.removed
        if self.verification is not None:
            status, detail = self.verification
            entry.verification = status
            entry.verification_detail = detail.model_dump(mode="json")
            entry.verified_at = instant if detail.checked else entry.verified_at


def remove_entry(
    session: Session, project_id: UUID, entry_id: UUID, data: LiteratureEntryCommand
) -> LiteratureEntryRead:
    return _change(session, project_id, entry_id, data, "removed", EntryChange(removed=True))


def restore_entry(
    session: Session, project_id: UUID, entry_id: UUID, data: LiteratureEntryCommand
) -> LiteratureEntryRead:
    # dedupe_key is unique per project, so a restored entry cannot duplicate another one.
    return _change(session, project_id, entry_id, data, "restored", EntryChange(removed=False))


def verify_entry(
    session: Session, project_id: UUID, entry_id: UUID, data: LiteratureEntryCommand
) -> LiteratureEntryRead:
    with session.begin():
        entry = _entry(session, project_id, entry_id)
        if _replayed(session, entry, data.command_id, "verified"):
            return _entry_read(session, entry)
        if entry.version != data.expected_version:
            raise error("ENTRY_VERSION_CONFLICT", "文献条目已变化，请刷新后再操作。")
        record = LiteratureRecord.model_validate(entry.record)
    outcome = verify_record(record)
    return _change(
        session, project_id, entry_id, data, "verified", EntryChange(verification=outcome)
    )


def list_entries(
    session: Session, project_id: UUID, *, include_removed: bool, limit: int, offset: int
) -> LiteratureEntryPage:
    with session.begin():
        _require_project(session, project_id)
        conditions = [LiteratureEntry.project_id == project_id]
        if not include_removed:
            conditions.append(LiteratureEntry.removed.is_(False))
        rows = session.scalars(
            select(LiteratureEntry)
            .where(*conditions)
            .order_by(LiteratureEntry.created_at.desc(), LiteratureEntry.id.desc())
            .limit(limit)
            .offset(offset)
        ).all()
        total = session.scalar(select(func.count()).select_from(LiteratureEntry).where(*conditions))
        return LiteratureEntryPage(
            items=[_entry_read(session, row) for row in rows],
            total=total or 0,
            limit=limit,
            offset=offset,
        )


def get_entry(session: Session, project_id: UUID, entry_id: UUID) -> LiteratureEntryRead:
    with session.begin():
        return _entry_read(session, _entry(session, project_id, entry_id))


def list_entry_versions(
    session: Session, project_id: UUID, entry_id: UUID, *, limit: int, offset: int
) -> LiteratureEntryVersionPage:
    with session.begin():
        entry = _entry(session, project_id, entry_id)
        rows = session.scalars(
            select(LiteratureEntryVersion)
            .where(LiteratureEntryVersion.entry_id == entry.id)
            .order_by(LiteratureEntryVersion.version.desc())
            .limit(limit)
            .offset(offset)
        ).all()
        total = session.scalar(
            select(func.count())
            .select_from(LiteratureEntryVersion)
            .where(LiteratureEntryVersion.entry_id == entry.id)
        )
        return LiteratureEntryVersionPage(
            items=[
                LiteratureEntryVersionRead.model_validate(
                    {
                        "version": row.version,
                        "action": row.action,
                        "removed": row.removed,
                        "verification": row.verification,
                        "verification_detail": row.verification_detail,
                        "created_at": row.created_at,
                    }
                )
                for row in rows
            ],
            total=total or 0,
            limit=limit,
            offset=offset,
        )
