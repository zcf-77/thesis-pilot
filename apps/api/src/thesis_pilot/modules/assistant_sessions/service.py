"""Explicit conversation/run transactions; Job owns execution and terminal state."""

import json
from datetime import UTC, datetime
from hashlib import sha256
from typing import cast
from uuid import UUID

from sqlalchemy import func, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from thesis_pilot.core.errors import AppError
from thesis_pilot.modules.ai_configs.service import freeze_config_version_chain
from thesis_pilot.modules.assistant_sessions.models import (
    AssistantCommand,
    AssistantMessage,
    AssistantRun,
    AssistantSession,
)
from thesis_pilot.modules.assistant_sessions.schemas import (
    AssistantContentInput,
    AssistantMessagePage,
    AssistantMessageRead,
    AssistantRunCommand,
    AssistantRunContext,
    AssistantRunCreate,
    AssistantRunPage,
    AssistantRunRead,
    AssistantRunReceipt,
    AssistantRunRetryReceipt,
    AssistantSessionCreate,
    AssistantSessionPage,
    AssistantSessionRead,
    AssistantSessionUpdate,
)
from thesis_pilot.modules.documents.content import view_of
from thesis_pilot.modules.documents.models import Document, DocumentVersion
from thesis_pilot.modules.documents.structure import JsonObject
from thesis_pilot.modules.jobs.models import Job
from thesis_pilot.modules.jobs.schemas import JobRead, JobStatus
from thesis_pilot.modules.materials.service import freeze_project_sources, load_import_source
from thesis_pilot.modules.projects.models import Project
from thesis_pilot.modules.revisions.models import RevisionCandidate, RevisionProposal
from thesis_pilot.modules.revisions.protection_v2 import resolve_for_view
from thesis_pilot.modules.revisions.service import (
    create_model_revision_in_transaction,
    end_model_revision_in_transaction,
    submit_model_proposal_in_transaction,
)

MAX_CONTEXT_BYTES = 256 * 1024


def error(code: str, message: str, status: int = 409) -> AppError:
    return AppError("ASSISTANT_" + code, message, status)


def _require_project(session: Session, project_id: UUID) -> None:
    if session.get(Project, project_id) is None:
        raise AppError("PROJECT_NOT_FOUND", "项目不存在。", 404)


def _session(
    session: Session, project_id: UUID, session_id: UUID, *, lock: bool = False
) -> AssistantSession:
    query = select(AssistantSession).where(
        AssistantSession.id == session_id, AssistantSession.project_id == project_id
    )
    if lock:
        query = query.with_for_update()
    found = session.scalar(query.execution_options(populate_existing=True))
    if found is None:
        raise error("SESSION_NOT_FOUND", "项目中没有该会话。", 404)
    return found


def _run(session: Session, project_id: UUID, run_id: UUID) -> AssistantRun:
    found = session.scalar(
        select(AssistantRun).where(AssistantRun.id == run_id, AssistantRun.project_id == project_id)
    )
    if found is None:
        raise error("RUN_NOT_FOUND", "项目中没有该助手运行。", 404)
    return found


def _job(session: Session, run: AssistantRun) -> Job:
    job = session.get(Job, run.job_id) if run.job_id else None
    if job is None or job.project_id != run.project_id or job.kind != "content_revision":
        raise error("RUN_INVALID", "助手运行与执行任务不一致。")
    return job


def _read_run(session: Session, run: AssistantRun) -> AssistantRunRead:
    job = _job(session, run)
    candidate = session.get(RevisionCandidate, run.candidate_id) if run.candidate_id else None
    visible_candidate = (
        job.status == "succeeded"
        and candidate is not None
        and candidate.run_id == run.id
        and session.get(RevisionProposal, candidate.id) is not None
    )
    return AssistantRunRead(
        id=run.id,
        project_id=run.project_id,
        session_id=run.session_id,
        purpose="content_revision",
        job_id=job.id,
        status=cast(JobStatus, job.status),
        trigger_message_id=run.trigger_message_id,
        result_message_id=run.result_message_id,
        candidate_id=run.candidate_id if visible_candidate else None,
        source_run_id=run.source_run_id,
        document_id=run.document_id,
        document_version=run.document_version,
        error_code=job.error_code,
        created_at=run.created_at,
        updated_at=job.updated_at,
    )


def _assert_idle(session: Session, conversation: AssistantSession) -> None:
    if conversation.archived:
        raise error("SESSION_ARCHIVED", "请先恢复会话再发起运行。")
    active = session.scalar(
        select(AssistantRun.id)
        .join(Job, Job.id == AssistantRun.job_id)
        .where(
            AssistantRun.session_id == conversation.id,
            Job.status.in_(["queued", "running"]),
        )
        .limit(1)
    )
    if active is not None:
        raise error("SESSION_BUSY", "当前会话仍有运行中的任务，请等待或取消。")


def _hash(operation: str, project_id: UUID, payload: object) -> str:
    return sha256(
        json.dumps(
            {"operation": operation, "project_id": str(project_id), "input": payload},
            sort_keys=True,
            separators=(",", ":"),
            ensure_ascii=False,
        ).encode()
    ).hexdigest()


def _command(
    session: Session, project_id: UUID, command_id: UUID, operation: str, digest: str
) -> AssistantRun | None:
    command = session.get(AssistantCommand, command_id)
    if command is None:
        return None
    if (
        command.project_id != project_id
        or command.operation != operation
        or command.request_hash != digest
    ):
        raise error("COMMAND_CONFLICT", "助手命令已用于不同请求。")
    return _run(session, project_id, command.run_id)


def _record_command(
    session: Session, run: AssistantRun, command_id: UUID, operation: str, digest: str
) -> None:
    session.add(
        AssistantCommand(
            command_id=command_id,
            project_id=run.project_id,
            run_id=run.id,
            operation=operation,
            request_hash=digest,
        )
    )
    session.flush()


def create_session(
    session: Session, project_id: UUID, data: AssistantSessionCreate
) -> AssistantSessionRead:
    with session.begin():
        _require_project(session, project_id)
        row = AssistantSession(project_id=project_id, title=data.title)
        session.add(row)
        session.flush()
        return AssistantSessionRead.model_validate(row)


def list_sessions(
    session: Session, project_id: UUID, *, limit: int, offset: int, include_archived: bool = False
) -> AssistantSessionPage:
    with session.begin():
        _require_project(session, project_id)
        conditions = [AssistantSession.project_id == project_id]
        if not include_archived:
            conditions.append(AssistantSession.archived.is_(False))
        rows = session.scalars(
            select(AssistantSession)
            .where(*conditions)
            .order_by(AssistantSession.updated_at.desc(), AssistantSession.id)
            .limit(limit)
            .offset(offset)
        ).all()
        return AssistantSessionPage(
            items=[AssistantSessionRead.model_validate(row) for row in rows],
            total=session.scalar(
                select(func.count()).select_from(AssistantSession).where(*conditions)
            )
            or 0,
            limit=limit,
            offset=offset,
        )


def get_session(session: Session, project_id: UUID, session_id: UUID) -> AssistantSessionRead:
    with session.begin():
        return AssistantSessionRead.model_validate(_session(session, project_id, session_id))


def update_session(
    session: Session, project_id: UUID, session_id: UUID, data: AssistantSessionUpdate
) -> AssistantSessionRead:
    with session.begin():
        _session(session, project_id, session_id)
        row = session.scalars(
            update(AssistantSession)
            .where(
                AssistantSession.id == session_id,
                AssistantSession.project_id == project_id,
                AssistantSession.version == data.expected_version,
            )
            .values(
                **data.model_dump(exclude_unset=True, exclude={"expected_version"}),
                version=AssistantSession.version + 1,
                updated_at=datetime.now(UTC),
            )
            .returning(AssistantSession)
            .execution_options(synchronize_session=False, populate_existing=True)
        ).one_or_none()
        if row is None:
            raise error("SESSION_VERSION_CONFLICT", "会话已变化，请重新读取；输入草稿保持。")
        return AssistantSessionRead.model_validate(row)


def list_messages(
    session: Session, project_id: UUID, session_id: UUID, *, limit: int, offset: int
) -> AssistantMessagePage:
    with session.begin():
        _session(session, project_id, session_id)
        rows = session.scalars(
            select(AssistantMessage)
            .where(AssistantMessage.session_id == session_id)
            .order_by(AssistantMessage.seq)
            .limit(limit)
            .offset(offset)
        ).all()
        return AssistantMessagePage(
            items=[AssistantMessageRead.model_validate(row) for row in rows],
            total=session.scalar(
                select(func.count())
                .select_from(AssistantMessage)
                .where(AssistantMessage.session_id == session_id)
            )
            or 0,
            limit=limit,
            offset=offset,
        )


def _freeze(
    session: Session, project_id: UUID, conversation: AssistantSession, data: AssistantContentInput
) -> tuple[dict[str, object], dict[str, object]]:
    document = session.scalar(
        select(Document).where(Document.id == data.document_id, Document.project_id == project_id)
    )
    if document is None:
        raise AppError("DOCUMENT_NOT_FOUND", "项目中没有指定正式稿。", 404)
    if document.current_version != data.document_version:
        raise error("CONTEXT_STALE", "正文已变化，请重新选择已保存的文字。")
    version = session.get(DocumentVersion, (document.id, data.document_version))
    if version is None:
        raise AppError("DOCUMENT_VERSION_NOT_FOUND", "指定正文版本不存在。", 404)
    resolve_for_view(view_of(version), data.selection)
    project_sources = freeze_project_sources(session, project_id)
    binding = cast(dict[str, object], project_sources["binding"])
    expected_binding = (
        str(data.source_binding_version_id) if data.source_binding_version_id else None
    )
    if binding.get("current_version_id") != expected_binding:
        raise error("CONTEXT_STALE", "模板或要求绑定已变化，请明确选择当前适用版本。")
    configuration = freeze_config_version_chain(session, data.agent_config_version_id)
    agent = configuration.get("agent")
    if (
        configuration.get("config_kind") != "agent"
        or not isinstance(agent, dict)
        or agent.get("role") != "content"
    ):
        raise error("AGENT_INVALID", "本阶段只接受启用的内容助手配置。", 422)
    materials: list[dict[str, object]] = []
    for selected in data.material_sources:
        source = load_import_source(
            session,
            project_id,
            selected.material_id,
            selected.original_version_id,
            selected.parse_version_id,
        )
        anchors = {anchor.id: anchor for anchor in source.parsed.result.anchors}
        if any(anchor_id not in anchors for anchor_id in selected.anchor_ids):
            raise error("SOURCE_INVALID", "选择的资料片段不存在于指定解析版本。", 422)
        materials.append(
            {
                "material_id": str(selected.material_id),
                "original_version_id": str(selected.original_version_id),
                "parse_version_id": str(selected.parse_version_id),
                "filename": source.original.filename,
                "original_sha256": source.original.sha256,
                "anchors": [
                    {
                        "anchor_id": anchor_id,
                        "text": anchors[anchor_id].original_text,
                        "part": anchors[anchor_id].part,
                        "line": anchors[anchor_id].line,
                        "xml_path": anchors[anchor_id].xml_path,
                    }
                    for anchor_id in selected.anchor_ids
                ],
            }
        )
    recent = list(
        session.scalars(
            select(AssistantMessage)
            .where(AssistantMessage.session_id == conversation.id)
            .order_by(AssistantMessage.seq.desc())
            .limit(10)
        )
    )
    context: dict[str, object] = {
        "schema_version": 1,
        "selection_text": data.selection.text,
        "goal": data.goal,
        "materials": materials,
        "project_sources": project_sources,
        "history": [
            {"message_id": str(message.id), "role": message.role, "content": message.content}
            for message in reversed(recent)
        ],
    }
    if (
        len(json.dumps(context, ensure_ascii=False, allow_nan=False).encode()) > MAX_CONTEXT_BYTES
        or len(json.dumps(configuration, ensure_ascii=False).encode()) > 80 * 1024
    ):
        raise error("CONTEXT_TOO_LARGE", "上下文超过限制，请减少明确选择的资料或新建会话。", 413)
    return context, configuration


def _new_run(
    session: Session,
    project_id: UUID,
    conversation: AssistantSession,
    message: AssistantMessage,
    data: AssistantContentInput,
    context: dict[str, object],
    configuration: dict[str, object],
    command_id: UUID,
    digest: str,
    source_run_id: UUID | None = None,
    source_job_id: UUID | None = None,
) -> AssistantRun:
    from thesis_pilot.modules.jobs.service import enqueue_content_revision

    run = AssistantRun(
        project_id=project_id,
        session_id=conversation.id,
        document_id=data.document_id,
        document_version=data.document_version,
        trigger_message_id=message.id,
        command_id=command_id,
        request_hash=digest,
        input_snapshot=data.model_dump(mode="json"),
        context_snapshot=context,
        configuration_snapshot=configuration,
        source_run_id=source_run_id,
    )
    session.add(run)
    session.flush()
    candidate = create_model_revision_in_transaction(
        session,
        project_id,
        data.document_id,
        data.document_version,
        data.selection,
        data.goal,
        run.id,
    )
    run.candidate_id = candidate.id
    job = enqueue_content_revision(
        session, project_id, run.id, "assistant:" + str(command_id), source_job_id
    )
    run.job_id = job.id
    conversation.version += 1
    conversation.updated_at = datetime.now(UTC)
    session.flush()
    return run


def _receipt(session: Session, run: AssistantRun) -> AssistantRunReceipt:
    conversation = _session(session, run.project_id, run.session_id)
    message = session.get(AssistantMessage, run.trigger_message_id)
    if message is None:
        raise error("RUN_INVALID", "助手运行的原始消息不存在。")
    return AssistantRunReceipt(
        session=AssistantSessionRead.model_validate(conversation),
        message=AssistantMessageRead.model_validate(message),
        run=_read_run(session, run),
        job=JobRead.model_validate(_job(session, run)),
    )


def create_run(
    session: Session, project_id: UUID, session_id: UUID, data: AssistantRunCreate
) -> AssistantRunReceipt:
    data = AssistantRunCreate.model_validate(data.model_dump(mode="json"))
    digest = _hash(
        "create_run",
        project_id,
        {"session_id": str(session_id), **data.model_dump(mode="json", exclude={"command_id"})},
    )
    try:
        with session.begin():
            previous = _command(session, project_id, data.command_id, "create_run", digest)
            if previous is not None:
                return _receipt(session, previous)
            conversation = _session(session, project_id, session_id, lock=True)
            previous = _command(session, project_id, data.command_id, "create_run", digest)
            if previous is not None:
                return _receipt(session, previous)
            if conversation.version != data.expected_session_version:
                raise error("SESSION_VERSION_CONFLICT", "会话已变化，请重新读取后发送；草稿保持。")
            _assert_idle(session, conversation)
            context, configuration = _freeze(session, project_id, conversation, data.input)
            message = AssistantMessage(
                session_id=session_id,
                seq=conversation.next_message_seq,
                role="user",
                content=data.input.goal,
            )
            conversation.next_message_seq += 1
            session.add(message)
            session.flush()
            run = _new_run(
                session,
                project_id,
                conversation,
                message,
                data.input,
                context,
                configuration,
                data.command_id,
                digest,
            )
            _record_command(session, run, data.command_id, "create_run", digest)
            return _receipt(session, run)
    except IntegrityError:
        with session.begin():
            previous = _command(session, project_id, data.command_id, "create_run", digest)
            if previous is not None:
                return _receipt(session, previous)
        raise


def get_run(session: Session, project_id: UUID, run_id: UUID) -> AssistantRunRead:
    with session.begin():
        return _read_run(session, _run(session, project_id, run_id))


def list_runs(
    session: Session, project_id: UUID, session_id: UUID, *, limit: int, offset: int
) -> AssistantRunPage:
    with session.begin():
        _session(session, project_id, session_id)
        rows = session.scalars(
            select(AssistantRun)
            .where(AssistantRun.session_id == session_id)
            .order_by(AssistantRun.created_at.desc(), AssistantRun.id)
            .limit(limit)
            .offset(offset)
        ).all()
        return AssistantRunPage(
            items=[_read_run(session, row) for row in rows],
            total=session.scalar(
                select(func.count())
                .select_from(AssistantRun)
                .where(AssistantRun.session_id == session_id)
            )
            or 0,
            limit=limit,
            offset=offset,
        )


def get_context(session: Session, project_id: UUID, run_id: UUID) -> AssistantRunContext:
    with session.begin():
        run = _run(session, project_id, run_id)
        result = AssistantRunContext(
            run_id=run.id,
            input=AssistantContentInput.model_validate(run.input_snapshot),
            context_snapshot=cast(JsonObject, run.context_snapshot),
            configuration_snapshot=cast(JsonObject, run.configuration_snapshot),
        )
        if len(result.model_dump_json().encode()) > 1024 * 1024:
            raise error("CONTEXT_TOO_LARGE", "固定上下文超过读取限制。", 413)
        return result


def load_run_snapshot_in_transaction(
    session: Session, project_id: UUID, run_id: UUID, job_id: UUID
) -> dict[str, object]:
    if not session.in_transaction():
        raise RuntimeError("Run context requires the caller's transaction")
    run = _run(session, project_id, run_id)
    if run.job_id != job_id or run.candidate_id is None:
        raise error("RUN_INVALID", "助手运行与执行任务不一致。")
    data = AssistantContentInput.model_validate(run.input_snapshot)
    return {
        "input_snapshot": run.input_snapshot,
        "context_snapshot": run.context_snapshot,
        "configuration_snapshot": run.configuration_snapshot,
        "session_id": str(run.session_id),
        "document_id": str(data.document_id),
        "document_version": data.document_version,
        "selection": data.selection.model_dump(by_alias=True),
        "goal": data.goal,
        "candidate_id": str(run.candidate_id),
    }


def commit_run_result_in_transaction(
    session: Session, project_id: UUID, run_id: UUID, job_id: UUID, result: dict[str, object]
) -> dict[str, object]:
    load_run_snapshot_in_transaction(session, project_id, run_id, job_id)
    run = _run(session, project_id, run_id)
    if run.result_message_id is not None:
        return {
            "run_id": str(run.id),
            "session_id": str(run.session_id),
            "message_id": str(run.result_message_id),
            "candidate_id": str(run.candidate_id),
        }
    reply, replacement = result.get("reply"), result.get("replacement")
    if (
        not isinstance(reply, str)
        or not reply.strip()
        or len(reply) > 4000
        or "\x00" in reply
        or not isinstance(replacement, str)
        or len(replacement) > 32768
    ):
        raise error("RESULT_INVALID", "模型回复不满足固定内容候选结构。", 422)
    assert run.candidate_id is not None
    conversation = _session(session, project_id, run.session_id, lock=True)
    submit_model_proposal_in_transaction(
        session, project_id, run.document_id, run.candidate_id, run.id, replacement
    )
    message = AssistantMessage(
        session_id=run.session_id,
        seq=conversation.next_message_seq,
        role="assistant",
        content=reply,
        run_id=run.id,
    )
    conversation.next_message_seq += 1
    conversation.version += 1
    conversation.updated_at = datetime.now(UTC)
    session.add(message)
    session.flush()
    run.result_message_id = message.id
    run.updated_at = datetime.now(UTC)
    session.flush()
    return {
        "run_id": str(run.id),
        "session_id": str(run.session_id),
        "message_id": str(message.id),
        "candidate_id": str(run.candidate_id),
    }


def end_run_in_transaction(
    session: Session, project_id: UUID, run_id: UUID, job_id: UUID, error_code: str | None
) -> None:
    load_run_snapshot_in_transaction(session, project_id, run_id, job_id)
    run = _run(session, project_id, run_id)
    assert run.candidate_id is not None
    end_model_revision_in_transaction(
        session, project_id, run.document_id, run.candidate_id, run.id, error_code
    )


def cancel_run(
    session: Session, project_id: UUID, run_id: UUID, data: AssistantRunCommand
) -> AssistantRunRead:
    from thesis_pilot.modules.jobs.service import cancel_content_revision_in_transaction

    digest = _hash("cancel_run", project_id, {"run_id": str(run_id)})
    try:
        with session.begin():
            previous = _command(session, project_id, data.command_id, "cancel_run", digest)
            if previous is not None:
                return _read_run(session, previous)
            run = _run(session, project_id, run_id)
            if run.job_id is None:
                raise error("RUN_INVALID", "助手任务尚未建立。")
            cancel_content_revision_in_transaction(session, project_id, run.job_id)
            _record_command(session, run, data.command_id, "cancel_run", digest)
            return _read_run(session, run)
    except IntegrityError:
        with session.begin():
            previous = _command(session, project_id, data.command_id, "cancel_run", digest)
            if previous is not None:
                return _read_run(session, previous)
        raise


def _retry_budget(session: Session, source: AssistantRun) -> None:
    api = source.configuration_snapshot.get("api")
    budget = api.get("max_retries", 0) if isinstance(api, dict) else 0
    if type(budget) is not int or not 0 <= budget <= 3:
        raise error("RUN_INVALID", "重试预算配置无效。")
    root = source
    seen = {root.id}
    while root.source_run_id is not None:
        root = _run(session, source.project_id, root.source_run_id)
        if root.id in seen or len(seen) > 100:
            raise error("RUN_INVALID", "重试来源链无效。")
        seen.add(root.id)
    pending, retries = [root.id], 0
    while pending:
        pending = list(
            session.scalars(
                select(AssistantRun.id)
                .where(AssistantRun.source_run_id.in_(pending))
                .limit(budget + 1)
            )
        )
        retries += len(pending)
        if retries >= budget:
            raise AppError("MODEL_RETRY_LIMIT_REACHED", "已达到该固定配置的显式重试次数。", 409)
    if budget == 0:
        raise AppError("MODEL_RETRY_LIMIT_REACHED", "该固定配置不允许重试。", 409)


def retry_run(
    session: Session, project_id: UUID, run_id: UUID, data: AssistantRunCommand
) -> AssistantRunRetryReceipt:
    digest = _hash("retry_run", project_id, {"run_id": str(run_id)})
    try:
        with session.begin():
            previous = _command(session, project_id, data.command_id, "retry_run", digest)
            if previous is not None:
                receipt = _receipt(session, previous)
                return AssistantRunRetryReceipt(
                    session=receipt.session, run=receipt.run, job=receipt.job
                )
            original = _run(session, project_id, run_id)
            old_job = _job(session, original)
            if old_job.status not in {"failed", "cancelled"}:
                raise error("RUN_RETRY_INVALID", "只可重试失败或已取消的运行。")
            conversation = _session(session, project_id, original.session_id, lock=True)
            previous = _command(session, project_id, data.command_id, "retry_run", digest)
            if previous is not None:
                receipt = _receipt(session, previous)
                return AssistantRunRetryReceipt(
                    session=receipt.session, run=receipt.run, job=receipt.job
                )
            _assert_idle(session, conversation)
            _retry_budget(session, original)
            fixed = AssistantContentInput.model_validate(original.input_snapshot)
            # Revalidate references/current versions, but retain the exact prior
            # input, configuration and quoted history rather than refreezing it.
            _, configuration = _freeze(session, project_id, conversation, fixed)
            if configuration != original.configuration_snapshot:
                raise error("CONTEXT_STALE", "固定配置已变化，请重新选择后发送。")
            message = session.get(AssistantMessage, original.trigger_message_id)
            if message is None:
                raise error("RUN_INVALID", "原始消息不存在。")
            retry = _new_run(
                session,
                project_id,
                conversation,
                message,
                fixed,
                original.context_snapshot,
                original.configuration_snapshot,
                data.command_id,
                digest,
                original.id,
                old_job.id,
            )
            _record_command(session, retry, data.command_id, "retry_run", digest)
            receipt = _receipt(session, retry)
            return AssistantRunRetryReceipt(
                session=receipt.session, run=receipt.run, job=receipt.job
            )
    except IntegrityError:
        with session.begin():
            previous = _command(session, project_id, data.command_id, "retry_run", digest)
            if previous is not None:
                receipt = _receipt(session, previous)
                return AssistantRunRetryReceipt(
                    session=receipt.session, run=receipt.run, job=receipt.job
                )
        raise
