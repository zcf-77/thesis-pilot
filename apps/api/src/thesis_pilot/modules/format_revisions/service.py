"""Source-evidenced whitelist formatting; one document lock owns each command."""

import re
from collections.abc import Callable
from copy import deepcopy
from datetime import UTC, datetime
from typing import cast
from uuid import UUID, uuid4

from pydantic import ValidationError
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from thesis_pilot.core.errors import AppError
from thesis_pilot.modules.document_sources.contracts import (
    FORMAT_GUARD_VERSION,
    SourceGuardContract,
    node_at,
)
from thesis_pilot.modules.document_sources.guards import (
    transition_for_contract,
    transition_for_history,
    validate_append,
)
from thesis_pilot.modules.document_sources.models import DocumentSource, DocumentSourceVersion
from thesis_pilot.modules.documents import service as documents
from thesis_pilot.modules.documents.models import Document
from thesis_pilot.modules.documents.schemas import DocumentContent
from thesis_pilot.modules.documents.structure import (
    MAX_SAFE_INTEGER,
    JsonObject,
    canonical_editor_json,
)
from thesis_pilot.modules.format_revisions.models import FormatCandidate, FormatCommandReceipt
from thesis_pilot.modules.format_revisions.schemas import (
    FormatApply,
    FormatCommand,
    FormatCommandRead,
    FormatContext,
    FormatCreate,
    FormatDecide,
    FormatPage,
    FormatPatch,
    FormatRead,
    FormatRule,
    FormatTarget,
    FormatUndo,
)
from thesis_pilot.modules.materials.models import (
    Material,
    MaterialOriginal,
    MaterialParseVersion,
    ProjectSourceBinding,
    ProjectSourceBindingVersion,
)
from thesis_pilot.modules.revisions.service import digest, locked_document, version
from thesis_pilot.parsers.schemas import ParsedMaterial


def fail(code: str, message: str, status: int = 409) -> AppError:
    return AppError("FORMAT_" + code, message, status)


def _parse(session: Session, project_id: UUID, parse_id: UUID, kind: str) -> ParsedMaterial:
    row = session.execute(
        select(MaterialParseVersion, MaterialOriginal, Material)
        .join(MaterialOriginal, MaterialOriginal.id == MaterialParseVersion.original_id)
        .join(Material, Material.id == MaterialOriginal.material_id)
        .where(MaterialParseVersion.id == parse_id, Material.project_id == project_id)
    ).one_or_none()
    if row is None:
        raise fail("SOURCE_STALE", "固定来源版本不可用，请重新绑定来源。")
    parsed, original, material = row
    if material.kind != kind or material.removed or not material.linked:
        raise fail("SOURCE_STALE", "固定来源已移除、解绑或改变分类。")
    try:
        result = ParsedMaterial.model_validate(parsed.content)
    except ValidationError as error:
        raise fail("RULE_INVALID", "来源解析结构不可核验。", 422) from error
    if any(anchor.original_version_id != original.id for anchor in result.anchors):
        raise fail("RULE_INVALID", "规则证据与固定原件版本不一致。", 422)
    return result


def _rules(parsed: ParsedMaterial, parse_id: UUID) -> list[FormatRule]:
    result: list[FormatRule] = []
    alignments = {"左对齐": "left", "居中": "center", "右对齐": "right", "两端对齐": "justify"}
    directives = (
        (r"标题层级[：:]\s*([1-6])", "level", "heading"),
        (r"标题对齐[：:]\s*(左对齐|居中)", "templateAlign", "heading"),
        (r"标题字重[：:]\s*(600|700)", "templateWeight", "heading"),
        (r"段落对齐[：:]\s*(左对齐|居中|右对齐|两端对齐)", "alignment", "paragraph"),
    )
    for anchor in parsed.anchors:
        if anchor.kind not in {"text", "paragraph", "heading"}:
            continue
        # Exact source text is data. It is never executed or used as instructions.
        text = anchor.original_text.strip()
        for pattern, field, scope in directives:
            match = re.fullmatch(pattern, text)
            if match:
                raw = match.group(1)
                value = int(raw) if field == "level" else alignments.get(raw, raw)
                result.append(
                    FormatRule.model_validate(
                        {
                            "id": f"{parse_id}:{anchor.id}:{field}",
                            "parse_version_id": parse_id,
                            "anchor_id": anchor.id,
                            "field": field,
                            "value": value,
                            "evidence": anchor.original_text,
                            "scope": scope,
                        }
                    )
                )
    anchors = {anchor.id: anchor for anchor in parsed.anchors}
    for item in parsed.template_items:
        if item.state != "recognized" or len(item.anchor_ids) != 1:
            continue
        item_anchor = anchors.get(item.anchor_ids[0])
        if (
            item_anchor is None
            or item_anchor.kind not in {"paragraph", "heading"}
            or item.scope != f"{item_anchor.kind}:{item_anchor.id}"
        ):
            continue
        field, item_value, scope = "", item.value, ""
        if item.field == "outline_level" and type(item_value) is int and 0 <= item_value <= 5:
            field, item_value, scope = "level", item_value + 1, "heading"
        elif item.field == "alignment" and item_value in {"left", "center", "right", "both"}:
            scope = "heading" if item_anchor.kind == "heading" else "paragraph"
            if scope == "heading" and item_value in {"left", "center"}:
                field = "templateAlign"
            elif scope == "paragraph":
                field, item_value = "alignment", "justify" if item_value == "both" else item_value
        if field:
            result.append(
                FormatRule.model_validate(
                    {
                        "id": f"{parse_id}:{item.id}",
                        "parse_version_id": parse_id,
                        "anchor_id": item_anchor.id,
                        "field": field,
                        "value": item_value,
                        "evidence": (
                            f"{item_anchor.original_text[:2000]}\n{item.field}={item.value}；{item.note}"
                        ),
                        "scope": scope,
                    }
                )
            )
    if len(result) > 1000 or len({item.id for item in result}) != len(result):
        raise fail("RULE_INVALID", "规则过多或来源标识不唯一。", 422)
    return result


def _context(session: Session, document: Document) -> FormatContext:
    content = documents.content_of(version(session, document.id, document.current_version))
    mapping = validate_append(session, document.id, document.current_version, content)
    if mapping is None:
        raise fail("SOURCE_REQUIRED", "请先从固定原件导入正式稿，再检查格式。", 422)
    source = session.get(DocumentSource, mapping.source_id)
    if source is None:
        raise fail("SOURCE_REQUIRED", "正式稿来源不可用。", 422)
    source_parse = session.get(MaterialParseVersion, source.parse_version_id)
    if source_parse is None:
        raise fail("SOURCE_REQUIRED", "正式稿来源解析不可用。", 422)
    parsed_source = ParsedMaterial.model_validate(source_parse.content)
    frozen = SourceGuardContract.model_validate(mapping.guard_contract)
    targets: list[FormatTarget] = []
    for anchor in parsed_source.anchors:
        if not anchor.editable or anchor.editor_path not in frozen.editable_paths:
            continue
        assert anchor.editor_path is not None
        node = node_at(content.json_content, anchor.editor_path)
        if node.get("type") not in {"heading", "paragraph"}:
            continue
        targets.append(
            FormatTarget.model_validate(
                {
                    "anchor_id": anchor.id,
                    "editor_path": anchor.editor_path,
                    "kind": node["type"],
                    "title": anchor.original_text[:200],
                    "attrs": node.get("attrs"),
                }
            )
        )
    if len(targets) > 1000 or len({target.anchor_id for target in targets}) != len(targets):
        raise fail("TARGET_INVALID", "可格式化目标过多或标识不唯一。", 422)
    binding = session.scalar(
        select(ProjectSourceBinding)
        .where(ProjectSourceBinding.project_id == document.project_id)
        .with_for_update(read=True)
        .execution_options(populate_existing=True)
    )
    if binding is None or binding.current_version_id is None:
        raise fail("BINDING_REQUIRED", "请先绑定明确的模板或论文要求来源。", 422)
    bound = session.get(ProjectSourceBindingVersion, binding.current_version_id)
    if bound is None or bound.project_id != document.project_id or bound.version != binding.version:
        raise fail("SOURCE_STALE", "来源绑定版本不一致。")
    rule_list: list[FormatRule] = []
    if bound.template_parse_version_id:
        rule_list.extend(
            _rules(
                _parse(session, document.project_id, bound.template_parse_version_id, "template"),
                bound.template_parse_version_id,
            )
        )
    requirements = [UUID(value) for value in bound.requirement_parse_version_ids]
    for parse_id in requirements:
        rule_list.extend(
            _rules(_parse(session, document.project_id, parse_id, "requirements"), parse_id)
        )
    if len(rule_list) > 1000:
        raise fail("RULE_INVALID", "固定来源规则超过安全上限。", 422)
    return FormatContext(
        document_version=document.current_version,
        binding_version_id=bound.id,
        binding_version=bound.version,
        template_parse_version_id=bound.template_parse_version_id,
        requirement_parse_version_ids=requirements,
        source_guard_digest=digest(mapping.guard_contract),
        targets=targets,
        rules=rule_list,
    )


def get_format_context(session: Session, project_id: UUID, document_id: UUID) -> FormatContext:
    with session.begin():
        return _context(session, locked_document(session, project_id, document_id, reading=True))


def _candidate(session: Session, document_id: UUID, candidate_id: UUID) -> FormatCandidate:
    item = session.scalar(
        select(FormatCandidate)
        .where(FormatCandidate.document_id == document_id, FormatCandidate.id == candidate_id)
        .with_for_update()
        .execution_options(populate_existing=True)
    )
    if item is None:
        raise fail("NOT_FOUND", "当前正文没有该格式候选。", 404)
    return item


def _receipt(row: FormatCommandReceipt) -> FormatCommandRead:
    return FormatCommandRead.model_validate(
        {
            name: getattr(row, name)
            for name in (
                "command_id",
                "candidate_id",
                "candidate_revision",
                "operation",
                "base_version",
                "result_version",
            )
        }
    )


def _read(session: Session, document: Document, item: FormatCandidate) -> FormatRead:
    application = session.scalar(
        select(FormatCommandReceipt.command_id).where(
            FormatCommandReceipt.candidate_id == item.id, FormatCommandReceipt.operation == "apply"
        )
    )
    applicable = item.status == "ready" and item.base_version == document.current_version
    if applicable:
        try:
            context = _context(session, document)
            applicable = context.model_dump(mode="json") == item.source_snapshot
        except AppError:
            applicable = False
    return FormatRead.model_validate(
        {
            "id": item.id,
            "document_id": document.id,
            "project_id": document.project_id,
            "base_version": item.base_version,
            "document_version": document.current_version,
            "revision": item.revision,
            "status": item.status,
            "applicable": applicable,
            "patches": item.patches_json,
            "decisions": item.decisions_json,
            "application_command_id": application,
            "created_at": item.created_at,
            "updated_at": item.updated_at,
        }
    )


def _execute(
    session: Session,
    project_id: UUID,
    document_id: UUID,
    operation: str,
    data: FormatCommand,
    target: UUID | None,
    action: Callable[[Document], tuple[FormatCandidate, int, int | None]],
) -> FormatCommandRead:
    checked = type(data).model_validate(data.model_dump())
    request = cast(
        JsonObject,
        {
            "operation": operation,
            "target": str(target) if target else None,
            "body": checked.model_dump(mode="json"),
        },
    )
    fingerprint = digest(request)
    with session.begin():
        document = locked_document(session, project_id, document_id)
        previous = session.get(FormatCommandReceipt, (document_id, data.command_id))
        if previous:
            if previous.request_hash != fingerprint:
                raise fail("COMMAND_CONFLICT", "同一格式命令标识不能对应不同请求。")
            return _receipt(previous)
        item, base, result = action(document)
        receipt = FormatCommandReceipt(
            document_id=document_id,
            command_id=data.command_id,
            candidate_id=item.id,
            candidate_revision=item.revision,
            operation=operation,
            request_hash=fingerprint,
            request_json=request,
            base_version=base,
            result_version=result,
            reverses_command_id=target if operation == "undo" else None,
        )
        session.add(receipt)
        session.flush()
        return _receipt(receipt)


def _patches(context: FormatContext, data: FormatCreate) -> list[JsonObject]:
    rules = {item.id: item for item in context.rules}
    targets = {item.anchor_id: item for item in context.targets}
    patches: list[JsonObject] = []
    slots: set[tuple[str, str]] = set()
    for selection in data.selections:
        rule = rules.get(selection.rule_id)
        if rule is None:
            raise fail("RULE_INVALID", "所选规则没有明确、可核验的固定来源。", 422)
        for anchor_id in selection.target_anchor_ids:
            target = targets.get(anchor_id)
            if target is None or target.kind != rule.scope:
                raise fail("TARGET_INVALID", "所选目标与规则范围不一致或不可编辑。", 422)
            slot = (anchor_id, rule.field)
            if slot in slots:
                raise fail("TARGET_INVALID", "同一目标属性不能重复或接受矛盾规则。", 422)
            slots.add(slot)
            before = (target.attrs or {}).get(rule.field)
            if before == rule.value:
                continue
            patch = FormatPatch(
                id=f"format-{len(patches) + 1}",
                anchor_id=anchor_id,
                editor_path=target.editor_path,
                field=rule.field,
                before=before,
                after=rule.value,
                rule_id=rule.id,
                evidence=rule.evidence,
            )
            patches.append(cast(JsonObject, patch.model_dump(mode="json")))
    if not patches or len(patches) > 1000:
        raise fail("NO_CHANGE", "所选目标已符合规则或超出安全上限。", 422)
    return patches


def create_format_revision(
    session: Session, project_id: UUID, document_id: UUID, data: FormatCreate
) -> FormatCommandRead:
    def action(document: Document) -> tuple[FormatCandidate, int, int | None]:
        if data.base_version != document.current_version:
            raise fail("STALE", "正文已变化，请重新检查格式。")
        context = _context(session, document)
        if (
            context.binding_version_id != data.binding_version_id
            or context.source_guard_digest != data.source_guard_digest
        ):
            raise fail("SOURCE_STALE", "模板、要求或来源保护版本已变化，请重新检查。")
        patches = _patches(context, data)
        item = FormatCandidate(
            id=uuid4(),
            document_id=document_id,
            base_version=data.base_version,
            input_json=cast(JsonObject, data.model_dump(mode="json")),
            patches_json=patches,
            source_snapshot=cast(JsonObject, context.model_dump(mode="json")),
            decisions_json=[{"patch_id": patch["id"], "decision": "pending"} for patch in patches],
            revision=1,
            status="ready",
            created_at=datetime.now(UTC),
            updated_at=datetime.now(UTC),
        )
        session.add(item)
        session.flush()
        return item, data.base_version, None

    return _execute(session, project_id, document_id, "create", data, None, action)


def _review(item: FormatCandidate, revision: int) -> None:
    if item.revision != revision or item.revision >= MAX_SAFE_INTEGER:
        raise fail("REVIEW_CONFLICT", "格式审阅决定已变化，请重新读取。")
    if item.status != "ready":
        raise fail("STATE_CONFLICT", "该格式候选已经采纳或撤销。")


def _advance(item: FormatCandidate) -> None:
    item.revision += 1
    item.updated_at = datetime.now(UTC)


def decide_format_revision(
    session: Session, project_id: UUID, document_id: UUID, candidate_id: UUID, data: FormatDecide
) -> FormatCommandRead:
    def action(document: Document) -> tuple[FormatCandidate, int, int | None]:
        item = _candidate(session, document.id, candidate_id)
        _review(item, data.expected_revision)
        known = {patch["id"] for patch in item.patches_json}
        updates = {choice.patch_id: choice.decision for choice in data.decisions}
        if len(updates) != len(data.decisions) or updates.keys() - known:
            raise fail("DECISION_INVALID", "格式决定必须对应唯一的已生成候选项。", 422)
        item.decisions_json = [
            {
                "patch_id": choice["patch_id"],
                "decision": updates.get(cast(str, choice["patch_id"]), choice["decision"]),
            }
            for choice in item.decisions_json
        ]
        _advance(item)
        session.flush()
        return item, item.base_version, None

    return _execute(session, project_id, document_id, "decide", data, candidate_id, action)


def apply_format_revision(
    session: Session, project_id: UUID, document_id: UUID, candidate_id: UUID, data: FormatApply
) -> FormatCommandRead:
    def action(document: Document) -> tuple[FormatCandidate, int, int | None]:
        item = _candidate(session, document_id, candidate_id)
        _review(item, data.expected_revision)
        if (
            item.base_version != document.current_version
            or data.expected_document_version != document.current_version
        ):
            raise fail("STALE", "正文已变化，旧格式候选不能采纳。")
        context = _context(session, document)
        if context.model_dump(mode="json") != item.source_snapshot:
            raise fail("SOURCE_STALE", "模板、要求、绑定或来源保护版本已变化。")
        if _patches(context, FormatCreate.model_validate(item.input_json)) != item.patches_json:
            raise fail("RULE_INVALID", "格式候选与服务器固定规则不一致。", 422)
        decisions = {choice["patch_id"]: choice["decision"] for choice in item.decisions_json}
        if "pending" in decisions.values():
            raise fail("DECISION_REQUIRED", "请先逐项接受或拒绝所有格式候选。", 422)
        accepted = [patch for patch in item.patches_json if decisions.get(patch["id"]) == "accept"]
        if not accepted:
            raise fail("NO_ACCEPTED_PATCHES", "尚未选择接受的格式项。", 422)
        mapping = session.get(DocumentSourceVersion, (document_id, item.base_version))
        assert mapping is not None
        contract = deepcopy(mapping.guard_contract)
        overlays = {
            tuple(cast(list[int], overlay["editor_path"])): deepcopy(overlay)
            for overlay in cast(list[JsonObject], contract.get("format_overrides") or [])
        }
        content = deepcopy(version(session, document_id, item.base_version).content_json)
        for patch in accepted:
            path = cast(list[int], patch["editor_path"])
            node = node_at(content, path)
            before_attrs = deepcopy(cast(JsonObject | None, node.get("attrs")))
            attrs = deepcopy(before_attrs or {})
            attrs[cast(str, patch["field"])] = patch["after"]
            node["attrs"] = attrs
            previous = overlays.get(tuple(path))
            overlays[tuple(path)] = cast(
                JsonObject,
                {
                    "anchor_id": patch["anchor_id"],
                    "editor_path": path,
                    "node_type": node["type"],
                    "original_attrs": previous["original_attrs"] if previous else before_attrs,
                    "target_attrs": deepcopy(attrs),
                },
            )
        contract["schema_version"] = 2
        contract["guard_version"] = FORMAT_GUARD_VERSION
        contract["format_overrides"] = [
            overlay
            for overlay in overlays.values()
            if overlay["original_attrs"] != overlay["target_attrs"]
        ]
        content = canonical_editor_json(content)
        transition = transition_for_contract(session, document_id, item.base_version, contract)
        saved = documents.append_guarded_document_version(
            session,
            project_id,
            document_id,
            item.base_version,
            DocumentContent(schema_version=1, json=content),
            "ai_adoption",
            transition,
        )
        item.status, item.result_version = "applied", saved.version
        _advance(item)
        session.flush()
        return item, item.base_version, saved.version

    return _execute(session, project_id, document_id, "apply", data, candidate_id, action)


def undo_format_revision(
    session: Session,
    project_id: UUID,
    document_id: UUID,
    application_command_id: UUID,
    data: FormatUndo,
) -> FormatCommandRead:
    def action(document: Document) -> tuple[FormatCandidate, int, int | None]:
        applied = session.get(FormatCommandReceipt, (document_id, application_command_id))
        if applied is None or applied.operation != "apply":
            raise fail("UNDO_CONFLICT", "该记录不是当前正文的格式采纳命令。")
        item = _candidate(session, document_id, applied.candidate_id)
        if (
            item.status != "applied"
            or applied.result_version != document.current_version
            or data.expected_document_version != document.current_version
        ):
            raise fail("UNDO_CONFLICT", "采纳后已有其他变更或已撤销，请先比较历史。")
        original = version(session, document_id, applied.base_version)
        saved = documents.append_guarded_document_version(
            session,
            project_id,
            document_id,
            document.current_version,
            documents.content_of(original),
            "adoption_undo",
            transition_for_history(
                session, document_id, document.current_version, applied.base_version
            ),
        )
        item.status = "undone"
        _advance(item)
        session.flush()
        return item, data.expected_document_version, saved.version

    return _execute(session, project_id, document_id, "undo", data, application_command_id, action)


def get_format_revision(
    session: Session, project_id: UUID, document_id: UUID, candidate_id: UUID
) -> FormatRead:
    with session.begin():
        document = locked_document(session, project_id, document_id, reading=True)
        return _read(session, document, _candidate(session, document_id, candidate_id))


def list_format_revisions(
    session: Session, project_id: UUID, document_id: UUID, *, limit: int, offset: int
) -> FormatPage:
    with session.begin():
        document = locked_document(session, project_id, document_id, reading=True)
        total = (
            session.scalar(
                select(func.count())
                .select_from(FormatCandidate)
                .where(FormatCandidate.document_id == document_id)
            )
            or 0
        )
        items = session.scalars(
            select(FormatCandidate)
            .where(FormatCandidate.document_id == document_id)
            .order_by(FormatCandidate.created_at.desc())
            .limit(limit)
            .offset(offset)
        ).all()
        return FormatPage(
            items=[_read(session, document, item) for item in items],
            total=total,
            limit=limit,
            offset=offset,
        )


def get_format_command(
    session: Session, project_id: UUID, document_id: UUID, command_id: UUID
) -> FormatCommandRead:
    with session.begin():
        locked_document(session, project_id, document_id, reading=True)
        row = session.get(FormatCommandReceipt, (document_id, command_id))
        if row is None:
            raise fail("COMMAND_NOT_FOUND", "当前正文没有该格式命令。", 404)
        return _receipt(row)
