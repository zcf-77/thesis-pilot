"""One document lock and one transaction own every revision command."""

import hashlib
import json
from collections.abc import Callable
from datetime import UTC, datetime
from typing import cast
from uuid import UUID, uuid4

from sqlalchemy import func, select, update
from sqlalchemy.orm import Session

from thesis_pilot.core.errors import AppError
from thesis_pilot.modules.documents import service as documents
from thesis_pilot.modules.documents.models import Document, DocumentVersion
from thesis_pilot.modules.documents.schemas import DocumentContent
from thesis_pilot.modules.documents.structure import MAX_SAFE_INTEGER, JsonObject
from thesis_pilot.modules.revisions.anchors import apply_patches, resolve_selection
from thesis_pilot.modules.revisions.models import (
    RevisionCandidate,
    RevisionCommand,
    RevisionProposal,
)
from thesis_pilot.modules.revisions.protection import POLICY_DIGEST, check_patches, require_passed
from thesis_pilot.modules.revisions.schemas import (
    POLICY_VERSION,
    RevisionApply,
    RevisionCancel,
    RevisionCheck,
    RevisionCommandRead,
    RevisionCreate,
    RevisionDecide,
    RevisionDecision,
    RevisionOperation,
    RevisionPage,
    RevisionPatch,
    RevisionRead,
    RevisionRevert,
    RevisionSelection,
    RevisionSummary,
    RevisionUndo,
)
from thesis_pilot.modules.revisions.schemas import (
    RevisionCommand as CommandInput,
)
from thesis_pilot.modules.revisions.schemas import (
    RevisionProposal as ProposalInput,
)
from thesis_pilot.modules.revisions.transport import encoded_resource
from thesis_pilot.providers.deepseek import MODEL_ERROR_CODES


def fail(code: str, message: str, status: int = 409) -> AppError:
    return AppError("REVISION_" + code, message, status)


def digest(value: JsonObject | list[JsonObject]) -> str:
    return hashlib.sha256(
        json.dumps(
            value, ensure_ascii=False, sort_keys=True, separators=(",", ":"), allow_nan=False
        ).encode("utf-8")
    ).hexdigest()


def locked_document(
    session: Session, project_id: UUID, document_id: UUID, *, reading: bool = False
) -> Document:
    documents.require_project(session, project_id)
    document = session.scalar(
        select(Document)
        .where(Document.id == document_id, Document.project_id == project_id)
        .with_for_update(read=reading)
        .execution_options(populate_existing=True)
    )
    if document is None:
        raise documents.document_missing()
    return document


def candidate(
    session: Session, document_id: UUID, candidate_id: UUID, *, lock: bool = False
) -> RevisionCandidate:
    query = select(RevisionCandidate).where(
        RevisionCandidate.id == candidate_id, RevisionCandidate.document_id == document_id
    )
    if lock:
        query = query.with_for_update()
    found = session.scalar(query.execution_options(populate_existing=True))
    if found is None:
        raise fail("NOT_FOUND", "当前正文中没有该候选。", 404)
    return found


def version(session: Session, document_id: UUID, number: int) -> DocumentVersion:
    found = session.get(DocumentVersion, (document_id, number))
    if found is None:
        raise AppError("DOCUMENT_VERSION_NOT_FOUND", "指定正文版本不存在。", 404)
    return found


def selection_of(item: RevisionCandidate) -> RevisionSelection:
    return RevisionSelection.model_validate(item.input_json["selection"])


def current_policy(item: RevisionCandidate) -> bool:
    return item.policy_version == POLICY_VERSION and item.policy_digest == POLICY_DIGEST


def require_current(item: RevisionCandidate, document: Document) -> None:
    if item.base_version != document.current_version:
        raise fail("STALE", "正文已变化，请保留候选并重新生成后审阅。")
    if not current_policy(item):
        raise fail("POLICY_STALE", "保护策略已更新，请重新生成候选。")


def require_revision(item: RevisionCandidate, expected: int) -> None:
    if item.revision != expected or item.revision >= MAX_SAFE_INTEGER:
        raise fail("REVIEW_CONFLICT", "候选决定已变化，请重新读取后审阅。")


def advance(session: Session, item: RevisionCandidate, **changes: object) -> None:
    expected = item.revision
    changed = session.scalar(
        update(RevisionCandidate)
        .where(
            RevisionCandidate.id == item.id,
            RevisionCandidate.revision == expected,
            RevisionCandidate.revision < MAX_SAFE_INTEGER,
        )
        .values(**changes, revision=RevisionCandidate.revision + 1, updated_at=datetime.now(UTC))
        .returning(RevisionCandidate)
        .execution_options(synchronize_session=False, populate_existing=True)
    )
    if changed is None:
        raise fail("REVIEW_CONFLICT", "候选决定已变化，请重新读取后审阅。")


def command_read(command: RevisionCommand) -> RevisionCommandRead:
    return RevisionCommandRead.model_validate(
        {
            "command_id": command.command_id,
            "document_id": command.document_id,
            "candidate_id": command.candidate_id,
            "operation": command.operation,
            "candidate_revision": command.candidate_revision,
            "base_version": command.base_version,
            "result_version": command.result_version,
            "created_at": command.created_at,
        }
    )


def record(
    document: Document,
    operation: RevisionOperation,
    request: JsonObject,
    *,
    item: RevisionCandidate | None = None,
    base_version: int | None = None,
    result_version: int | None = None,
    reverses: UUID | None = None,
) -> RevisionCommand:
    body = cast(JsonObject, request["body"])
    return RevisionCommand(
        document_id=document.id,
        command_id=UUID(cast(str, body["command_id"])),
        operation=operation,
        request_hash=digest(request),
        request_json=request,
        candidate_id=item.id if item else None,
        candidate_revision=item.revision if item else None,
        base_version=base_version
        if base_version is not None
        else item.base_version
        if item
        else None,
        result_version=result_version,
        reverses_command_id=reverses,
        created_at=datetime.now(UTC),
    )


def execute(
    session: Session,
    project_id: UUID,
    document_id: UUID,
    operation: RevisionOperation,
    data: CommandInput,
    target: UUID | None,
    action: Callable[[Document, JsonObject], RevisionCommand],
) -> RevisionCommandRead:
    checked = type(data).model_validate(data.model_dump(by_alias=True))
    encoded_resource(checked)
    request: JsonObject = {
        "operation": operation,
        "target": str(target) if target else None,
        "body": checked.model_dump(mode="json", by_alias=True),
    }
    fingerprint = digest(request)
    with session.begin():
        document = locked_document(session, project_id, document_id)
        previous = session.get(RevisionCommand, (document_id, checked.command_id))
        if previous is not None:
            if previous.request_hash != fingerprint:
                raise fail("COMMAND_CONFLICT", "同一命令标识不能用于不同请求。")
            result = command_read(previous)
        else:
            command = action(document, request)
            session.add(command)
            session.flush()
            if command.candidate_id is not None:
                read_candidate(
                    session, document, candidate(session, document_id, command.candidate_id)
                )
            result = command_read(command)
        encoded_resource(result)
        return result


def summary(document: Document, item: RevisionCandidate) -> RevisionSummary:
    return RevisionSummary.model_validate(
        {
            "id": item.id,
            "project_id": document.project_id,
            "document_id": document.id,
            "base_version": item.base_version,
            "document_version": document.current_version,
            "revision": item.revision,
            "status": item.status,
            "result_version": item.result_version,
            "created_at": item.created_at,
            "updated_at": item.updated_at,
        }
    )


def read_candidate(session: Session, document: Document, item: RevisionCandidate) -> RevisionRead:
    proposal = session.get(RevisionProposal, item.id)
    checks = (
        [RevisionCheck.model_validate(check) for check in proposal.checks_json] if proposal else []
    )
    for check in checks:
        if check.rule == "version":
            check.result = "pass" if item.base_version == document.current_version else "fail"
    application = session.scalar(
        select(RevisionCommand.command_id).where(
            RevisionCommand.candidate_id == item.id, RevisionCommand.operation == "apply"
        )
    )
    result = RevisionRead.model_validate(
        {
            **summary(document, item).model_dump(),
            "selection": item.input_json["selection"],
            "goal": item.input_json["goal"],
            "policy_version": item.policy_version,
            "producer": item.producer,
            "run_id": item.run_id,
            "adoption_blocked_reason": "REVISION_ADOPTION_NOT_APPROVED"
            if item.producer == "model_run"
            else None,
            "generation_error_code": item.generation_error_code,
            "generation_token": item.generation_token
            if item.status == "generating" and item.producer == "deterministic_preview"
            else None,
            "patches": proposal.patches_json if proposal else [],
            "decisions": item.decisions_json,
            "checks": checks,
            "applicable": item.producer != "model_run"
            and item.status == "ready"
            and current_policy(item)
            and item.base_version == document.current_version
            and all(check.result == "pass" for check in checks),
            "application_command_id": application,
        }
    )
    encoded_resource(result)
    # A manual save or another candidate may grow this derived version without
    # writing this row. Reserve its longest allowed representation at creation.
    encoded_resource(
        result.model_copy(update={"document_version": MAX_SAFE_INTEGER, "applicable": False})
    )
    return result


def create_revision(
    session: Session, project_id: UUID, document_id: UUID, data: RevisionCreate
) -> RevisionCommandRead:
    def action(document: Document, request: JsonObject) -> RevisionCommand:
        if data.base_version != document.current_version:
            raise fail("STALE", "正文已变化，请先重新读取再选择修订范围。")
        source = version(session, document_id, data.base_version)
        resolved = resolve_selection(source.content_json, data.selection)
        now = datetime.now(UTC)
        item = RevisionCandidate(
            id=uuid4(),
            document_id=document_id,
            base_version=data.base_version,
            input_json={
                "selection": data.selection.model_dump(by_alias=True),
                "goal": data.goal,
                "context": {"from": resolved.start, "text": resolved.text},
            },
            policy_version=POLICY_VERSION,
            policy_digest=POLICY_DIGEST,
            generation_token=uuid4(),
            producer="deterministic_preview",
            status="generating",
            revision=1,
            decisions_json=[],
            result_version=None,
            created_at=now,
            updated_at=now,
        )
        session.add(item)
        session.flush()
        read_candidate(session, document, item)
        return record(document, "create", request, item=item)

    return execute(session, project_id, document_id, "create", data, None, action)


def _model_run_snapshot(
    session: Session,
    project_id: UUID,
    document_id: UUID,
    run_id: UUID,
    candidate_id: UUID | None = None,
) -> JsonObject:
    from thesis_pilot.modules.assistant_sessions.models import AssistantRun

    if not session.in_transaction():
        raise RuntimeError("Model revisions require the caller's transaction")
    run = session.get(AssistantRun, run_id)
    if (
        run is None
        or run.project_id != project_id
        or run.purpose != "content_revision"
        or run.document_id != document_id
        or run.input_snapshot.get("document_version") != run.document_version
        or (candidate_id is not None and run.candidate_id != candidate_id)
        or run.input_snapshot.get("document_id") != str(document_id)
    ):
        raise fail("RUN_INVALID", "候选与固定模型运行或项目范围不一致。", 422)
    if candidate_id is None and run.candidate_id is not None:
        linked = session.get(RevisionCandidate, run.candidate_id)
        if linked is None or linked.run_id != run_id or linked.document_id != document_id:
            raise fail("RUN_INVALID", "模型运行已关联其他候选，不能重新绑定。", 422)
    return cast(JsonObject, run.input_snapshot)


def _require_model_candidate(
    session: Session, project_id: UUID, document_id: UUID, candidate_id: UUID, run_id: UUID
) -> RevisionCandidate:
    item = candidate(session, document_id, candidate_id, lock=True)
    snapshot = _model_run_snapshot(session, project_id, document_id, run_id, candidate_id)
    if (
        item.producer != "model_run"
        or item.run_id != run_id
        or snapshot.get("document_version") != item.base_version
        or RevisionSelection.model_validate(snapshot.get("selection")) != selection_of(item)
        or snapshot.get("goal") != item.input_json.get("goal")
    ):
        raise fail("RUN_INVALID", "候选范围与服务器固定运行不一致。", 422)
    return item


def create_model_revision_in_transaction(
    session: Session,
    project_id: UUID,
    document_id: UUID,
    base_version: int,
    selection: RevisionSelection,
    goal: str,
    run_id: UUID,
) -> RevisionCandidate:
    """Reserve one candidate with the caller's message/run/job/outbox transaction."""
    snapshot = _model_run_snapshot(session, project_id, document_id, run_id)
    data = RevisionCreate.model_validate(
        {
            "command_id": uuid4(),
            "base_version": base_version,
            "selection": selection.model_dump(by_alias=True),
            "goal": goal,
        }
    )
    encoded_resource(data)
    if (
        snapshot.get("document_version") != data.base_version
        or RevisionSelection.model_validate(snapshot.get("selection")) != data.selection
        or snapshot.get("goal") != data.goal
    ):
        raise fail("RUN_INVALID", "候选输入必须来自服务器固定的运行快照。", 422)
    document = locked_document(session, project_id, document_id)
    existing = session.scalar(select(RevisionCandidate).where(RevisionCandidate.run_id == run_id))
    if existing is not None:
        if (
            existing.document_id != document_id
            or existing.base_version != base_version
            or existing.input_json.get("selection") != data.selection.model_dump(by_alias=True)
            or existing.input_json.get("goal") != goal
        ):
            raise fail("RUN_INVALID", "模型运行已关联不同候选输入。", 422)
        return existing
    if document.current_version != base_version:
        raise fail("STALE", "正文已变化，请重新读取后创建模型运行。")
    resolved = resolve_selection(
        version(session, document_id, base_version).content_json, data.selection
    )
    now = datetime.now(UTC)
    item = RevisionCandidate(
        id=uuid4(),
        document_id=document_id,
        base_version=base_version,
        input_json={
            "selection": data.selection.model_dump(by_alias=True),
            "goal": goal,
            "context": {"from": resolved.start, "text": resolved.text},
        },
        policy_version=POLICY_VERSION,
        policy_digest=POLICY_DIGEST,
        generation_token=uuid4(),
        producer="model_run",
        run_id=run_id,
        generation_error_code=None,
        status="generating",
        revision=1,
        decisions_json=[],
        result_version=None,
        created_at=now,
        updated_at=now,
    )
    session.add(item)
    session.flush()
    read_candidate(session, document, item)
    return item


def submit_model_proposal_in_transaction(
    session: Session,
    project_id: UUID,
    document_id: UUID,
    candidate_id: UUID,
    run_id: UUID,
    after: str,
) -> RevisionRead:
    """Only model replacement text crosses the boundary; offsets and before stay fixed."""
    if not session.in_transaction():
        raise RuntimeError("Model proposals require the caller's transaction")
    document = locked_document(session, project_id, document_id)
    item = _require_model_candidate(session, project_id, document_id, candidate_id, run_id)
    if item.status != "generating":
        raise fail("STATE_CONFLICT", "该模型生成已结束或取消，迟到结果未接收。")
    if not current_policy(item):
        raise fail("POLICY_STALE", "保护策略已更新，模型结果未接收。")
    selection = selection_of(item)
    patch = RevisionPatch.model_validate(
        {
            "id": "model-replacement",
            "from": selection.from_position,
            "to": selection.to,
            "before": selection.text,
            "after": after,
        }
    )
    encoded_resource(patch)
    resolved = resolve_selection(
        version(session, document_id, item.base_version).content_json, selection
    )
    checks = check_patches(
        resolved,
        selection,
        [patch],
        base_version=item.base_version,
        current_version=item.base_version,
    )
    patches = [cast(JsonObject, patch.model_dump(by_alias=True))]
    session.add(
        RevisionProposal(
            candidate_id=item.id,
            patches_json=patches,
            checks_json=[cast(JsonObject, check.model_dump(by_alias=True)) for check in checks],
            digest=digest(patches),
            created_at=datetime.now(UTC),
        )
    )
    session.flush()
    advance(
        session,
        item,
        status="ready" if all(check.result == "pass" for check in checks) else "invalid",
        decisions_json=[{"patch_id": patch.id, "decision": "pending"}],
    )
    return read_candidate(session, document, item)


def end_model_revision_in_transaction(
    session: Session,
    project_id: UUID,
    document_id: UUID,
    candidate_id: UUID,
    run_id: UUID,
    error_code: str | None = None,
) -> RevisionRead:
    """User cancellation and execution failure remain separate terminal facts."""
    if not session.in_transaction():
        raise RuntimeError("Model revision termination requires the caller's transaction")
    document = locked_document(session, project_id, document_id)
    item = _require_model_candidate(session, project_id, document_id, candidate_id, run_id)
    if item.status in {"cancelled", "failed"}:
        return read_candidate(session, document, item)
    if item.status != "generating":
        raise fail("STATE_CONFLICT", "该模型候选已接收结果，不能覆盖终态。")
    safe_code = None
    if error_code is not None:
        allowed = MODEL_ERROR_CODES | {
            "JOB_EXECUTION_FAILED",
            "JOB_EXECUTION_TIMEOUT",
            "JOB_ATTEMPTS_EXHAUSTED",
            "JOB_INPUT_INVALID",
            "JOB_RESULT_INVALID",
        }
        safe_code = error_code if error_code in allowed else "JOB_EXECUTION_FAILED"
    advance(
        session,
        item,
        status="failed" if safe_code else "cancelled",
        generation_error_code=safe_code,
    )
    return read_candidate(session, document, item)


def submit_proposal(
    session: Session, project_id: UUID, document_id: UUID, candidate_id: UUID, data: ProposalInput
) -> RevisionCommandRead:
    def action(document: Document, request: JsonObject) -> RevisionCommand:
        item = candidate(session, document_id, candidate_id, lock=True)
        if item.producer != "deterministic_preview":
            raise fail("PRODUCER_CONFLICT", "真实模型候选只能接收固定运行的服务器结果。")
        if item.status != "generating" or item.generation_token != data.generation_token:
            raise fail("STATE_CONFLICT", "该次生成已结束或已取消，迟到结果未接收。")
        if not current_policy(item):
            raise fail("POLICY_STALE", "保护策略已更新，请重新生成候选。")
        if len({patch.id for patch in data.patches}) != len(data.patches):
            raise fail("PATCH_INVALID", "补丁标识必须唯一。", 422)
        selection = selection_of(item)
        resolved = resolve_selection(
            version(session, document_id, item.base_version).content_json, selection
        )
        checks = check_patches(
            resolved,
            selection,
            data.patches,
            base_version=item.base_version,
            current_version=item.base_version,
        )
        patches = [cast(JsonObject, patch.model_dump(by_alias=True)) for patch in data.patches]
        session.add(
            RevisionProposal(
                candidate_id=item.id,
                patches_json=patches,
                checks_json=[cast(JsonObject, check.model_dump(by_alias=True)) for check in checks],
                digest=digest(patches),
                created_at=datetime.now(UTC),
            )
        )
        session.flush()
        decisions: list[JsonObject] = [
            {"patch_id": patch.id, "decision": "pending"} for patch in data.patches
        ]
        advance(
            session,
            item,
            status="ready" if all(check.result == "pass" for check in checks) else "invalid",
            decisions_json=decisions,
        )
        read_candidate(session, document, item)
        return record(document, "proposal", request, item=item)

    return execute(session, project_id, document_id, "proposal", data, candidate_id, action)


def decide_revision(
    session: Session, project_id: UUID, document_id: UUID, candidate_id: UUID, data: RevisionDecide
) -> RevisionCommandRead:
    def action(document: Document, request: JsonObject) -> RevisionCommand:
        item = candidate(session, document_id, candidate_id, lock=True)
        require_revision(item, data.expected_revision)
        if item.status not in {"ready", "invalid"}:
            raise fail("STATE_CONFLICT", "该候选已结束，不能修改审阅决定。")
        proposal = session.get(RevisionProposal, item.id)
        assert proposal is not None
        ids = [decision.patch_id for decision in data.decisions]
        if len(set(ids)) != len(ids) or set(ids) != {
            patch["id"] for patch in proposal.patches_json
        }:
            raise fail("PATCH_INVALID", "决定必须完整对应候选条目，不能重复或新增条目。", 422)
        if any(decision.decision == "accepted" for decision in data.decisions):
            require_current(item, document)
            require_passed([RevisionCheck.model_validate(check) for check in proposal.checks_json])
        decisions = [
            cast(JsonObject, decision.model_dump())
            for decision in sorted(data.decisions, key=lambda value: value.patch_id)
        ]
        if decisions != sorted(item.decisions_json, key=lambda value: cast(str, value["patch_id"])):
            advance(session, item, decisions_json=decisions)
        read_candidate(session, document, item)
        return record(document, "decide", request, item=item)

    return execute(session, project_id, document_id, "decide", data, candidate_id, action)


def apply_revision(
    session: Session, project_id: UUID, document_id: UUID, candidate_id: UUID, data: RevisionApply
) -> RevisionCommandRead:
    def action(document: Document, request: JsonObject) -> RevisionCommand:
        item = candidate(session, document_id, candidate_id, lock=True)
        if item.producer == "model_run":
            raise fail(
                "ADOPTION_NOT_APPROVED",
                "真实模型候选的采纳尚未通过保护样例签核，当前只能查看与审阅。",
            )
        require_revision(item, data.expected_revision)
        require_current(item, document)
        if data.expected_document_version != document.current_version:
            raise documents.version_conflict()
        if item.status not in {"ready", "invalid"}:
            raise fail("STATE_CONFLICT", "该候选已结束或取消，不能采纳。")
        proposal = session.get(RevisionProposal, item.id)
        assert proposal is not None
        if item.status == "invalid":
            require_passed([RevisionCheck.model_validate(check) for check in proposal.checks_json])
        accepted = {
            decision.patch_id
            for raw in item.decisions_json
            if (decision := RevisionDecision.model_validate(raw)).decision == "accepted"
        }
        if not accepted:
            raise fail("NOTHING_ACCEPTED", "请先选择要接受的候选条目。", 422)
        all_patches = [RevisionPatch.model_validate(raw) for raw in proposal.patches_json]
        selection = selection_of(item)
        base = version(session, document_id, item.base_version)
        resolved = resolve_selection(base.content_json, selection)
        require_passed(
            check_patches(
                resolved,
                selection,
                all_patches,
                base_version=item.base_version,
                current_version=document.current_version,
            )
        )
        patches = [patch for patch in all_patches if patch.id in accepted]
        require_passed(
            check_patches(
                resolved,
                selection,
                patches,
                base_version=item.base_version,
                current_version=document.current_version,
            )
        )
        result_json = apply_patches(resolved, patches)
        if result_json == base.content_json:
            raise fail("NO_CHANGE", "接受内容没有形成正文变化。", 422)
        saved = documents.append_document_version(
            session,
            project_id,
            document_id,
            data.expected_document_version,
            DocumentContent(schema_version=1, json=result_json),
            "ai_adoption",
        )
        advance(session, item, status="applied", result_version=saved.version)
        return record(
            document,
            "apply",
            request,
            item=item,
            base_version=data.expected_document_version,
            result_version=saved.version,
        )

    return execute(session, project_id, document_id, "apply", data, candidate_id, action)


def cancel_revision(
    session: Session, project_id: UUID, document_id: UUID, candidate_id: UUID, data: RevisionCancel
) -> RevisionCommandRead:
    def action(document: Document, request: JsonObject) -> RevisionCommand:
        item = candidate(session, document_id, candidate_id, lock=True)
        if item.status not in {"generating", "ready", "invalid"}:
            raise fail("STATE_CONFLICT", "该候选已经结束；已采纳内容须通过撤销操作处理。")
        advance(session, item, status="cancelled")
        return record(document, "cancel", request, item=item)

    return execute(session, project_id, document_id, "cancel", data, candidate_id, action)


def undo_revision(
    session: Session,
    project_id: UUID,
    document_id: UUID,
    application_command_id: UUID,
    data: RevisionUndo,
) -> RevisionCommandRead:
    def action(document: Document, request: JsonObject) -> RevisionCommand:
        application = session.get(RevisionCommand, (document_id, application_command_id))
        if application is None:
            raise fail("COMMAND_NOT_FOUND", "当前正文中没有该成功命令。", 404)
        if (
            application.operation != "apply"
            or application.candidate_id is None
            or application.base_version is None
        ):
            raise fail("UNDO_CONFLICT", "该记录不是可撤销的采纳操作。")
        item = candidate(session, document_id, application.candidate_id, lock=True)
        if (
            item.status != "applied"
            or application.result_version != document.current_version
            or data.expected_document_version != document.current_version
        ):
            raise fail("UNDO_CONFLICT", "采纳后已有其他变更或已撤销，请在历史中比较后决定。")
        original = version(session, document_id, application.base_version)
        saved = documents.append_document_version(
            session,
            project_id,
            document_id,
            data.expected_document_version,
            documents.content_of(original),
            "adoption_undo",
        )
        advance(session, item, status="undone")
        return record(
            document,
            "undo",
            request,
            item=item,
            base_version=data.expected_document_version,
            result_version=saved.version,
            reverses=application_command_id,
        )

    return execute(session, project_id, document_id, "undo", data, application_command_id, action)


def revert_document(
    session: Session, project_id: UUID, document_id: UUID, data: RevisionRevert
) -> RevisionCommandRead:
    def action(document: Document, request: JsonObject) -> RevisionCommand:
        if data.expected_document_version != document.current_version:
            raise documents.version_conflict()
        target = version(session, document_id, data.target_version)
        current = version(session, document_id, document.current_version)
        if target.content_json == current.content_json:
            raise fail("NO_CHANGE", "该历史版本与当前正文内容相同。", 422)
        saved = documents.append_document_version(
            session,
            project_id,
            document_id,
            data.expected_document_version,
            documents.content_of(target),
            "version_revert",
        )
        return record(
            document,
            "revert",
            request,
            base_version=data.expected_document_version,
            result_version=saved.version,
        )

    return execute(session, project_id, document_id, "revert", data, None, action)


def get_revision(
    session: Session, project_id: UUID, document_id: UUID, candidate_id: UUID
) -> RevisionRead:
    with session.begin():
        document = locked_document(session, project_id, document_id, reading=True)
        return read_candidate(session, document, candidate(session, document_id, candidate_id))


def list_revisions(
    session: Session, project_id: UUID, document_id: UUID, *, limit: int, offset: int
) -> RevisionPage:
    with session.begin():
        document = locked_document(session, project_id, document_id, reading=True)
        total = (
            session.scalar(
                select(func.count())
                .select_from(RevisionCandidate)
                .where(RevisionCandidate.document_id == document_id)
            )
            or 0
        )
        rows = session.scalars(
            select(RevisionCandidate)
            .where(RevisionCandidate.document_id == document_id)
            .order_by(RevisionCandidate.created_at.desc(), RevisionCandidate.id.desc())
            .limit(limit)
            .offset(offset)
        ).all()
        result = RevisionPage(
            items=[summary(document, item) for item in rows],
            total=total,
            limit=limit,
            offset=offset,
        )
        encoded_resource(result)
        return result


def get_command(
    session: Session, project_id: UUID, document_id: UUID, command_id: UUID
) -> RevisionCommandRead:
    with session.begin():
        locked_document(session, project_id, document_id, reading=True)
        command = session.get(RevisionCommand, (document_id, command_id))
        if command is None:
            raise fail("COMMAND_NOT_FOUND", "当前正文中没有该成功命令。", 404)
        return command_read(command)
