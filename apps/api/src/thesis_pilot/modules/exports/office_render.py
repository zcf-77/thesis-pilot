"""Word / PDF exports (SG-13B on the SG-22 editor).

* preserve: the immutable imported original + per-node same-paragraph text edits through
  ``/v1/docs/transactions`` (real ``w:ins``/``w:del``). Without track changes every produced
  revision is accepted in a second transaction, so the file is clean. Unsupported changes
  are reported, never dropped silently.
* regenerate: the manuscript model → DOCX by the vendored office-wasm (Node runner), with the
  runner's unsupported list and the imported objects the model does not carry as losses.
* pdf: the DOCX of the chosen mode → ``/v1/pdf``; kernel warnings are kept in the report.
"""

from __future__ import annotations

import base64
from copy import deepcopy
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any, cast
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.orm import Session

from thesis_pilot.core.errors import AppError
from thesis_pilot.modules.documents.docs_model import (
    RESOURCE_URI_PREFIX,
    model_of,
    protections_of,
)
from thesis_pilot.modules.documents.legacy_v1 import convert_v1
from thesis_pilot.modules.documents.models import DocumentResource, DocumentVersion
from thesis_pilot.modules.exports.contracts import DocumentExportInput
from thesis_pilot.modules.exports.office_plan import plan_preserve
from thesis_pilot.providers.office_runner import model_to_docx
from thesis_pilot.providers.office_server import OfficeServerClient, OfficeWarning

Obj = dict[str, Any]

AUTHOR = "ThesisPilot"


@dataclass(frozen=True)
class OfficeBaseline:
    version: int
    snapshot: Obj
    ir_map: Obj
    original: bytes


@dataclass(frozen=True)
class OfficeFacts:
    snapshot: Obj
    resources: dict[str, tuple[str, bytes]]
    baseline: OfficeBaseline | None
    revision_date: str


@dataclass(frozen=True)
class OfficeRendered:
    data: bytes
    report: dict[str, object]


def _resources(session: Session, project_id: UUID, model: Obj) -> dict[str, tuple[str, bytes]]:
    wanted = {
        cast(str, cast(Obj, item["data"])["value"])[len(RESOURCE_URI_PREFIX) :]
        for item in cast(list[Obj], model.get("resources", []))
    }
    if not wanted:
        return {}
    rows = session.scalars(
        select(DocumentResource).where(
            DocumentResource.project_id == project_id, DocumentResource.sha256.in_(sorted(wanted))
        )
    ).all()
    found = {row.sha256: (row.mime, bytes(row.content)) for row in rows}
    if set(found) != wanted:
        raise AppError("DOCMODEL_RESOURCE_MISSING", "正文引用的图片资源不存在。", 422)
    return found


def load_office_facts(
    session: Session, project_id: UUID, source: DocumentExportInput, version: DocumentVersion
) -> OfficeFacts:
    if version.schema_version == 2:
        snapshot = cast(Obj, version.content_json)
    else:
        # Read-only in-memory conversion (same as ``?as=v2``); never written back.
        snapshot = convert_v1(
            version.content_json, document_id=source.document_id, version=version.version
        ).snapshot
    baseline: OfficeBaseline | None = None
    if source.office_mode == "preserve":
        from thesis_pilot.modules.document_sources.office_service import baseline_for
        from thesis_pilot.modules.materials.models import MaterialOriginal

        found = baseline_for(session, source.document_id, source.document_version)
        if found is None:
            raise AppError(
                "EXPORT_OFFICE_SOURCE_MISSING",
                "该正文版本没有导入的 Word 原件，无法保留原件导出；请选择重新生成。",
                422,
            )
        link, row = found
        base_version = session.get(DocumentVersion, (source.document_id, link.document_version))
        original = session.get(MaterialOriginal, row.original_id)
        if base_version is None or original is None or original.sha256 != row.original_sha256:
            raise AppError("EXPORT_SOURCE_CHANGED", "原件或导入基线与创建导出时不一致。", 409)
        baseline = OfficeBaseline(
            version=link.document_version,
            snapshot=cast(Obj, base_version.content_json),
            ir_map=cast(Obj, row.ir_map),
            original=bytes(original.data),
        )
    created = version.created_at
    created = created.replace(tzinfo=UTC) if created.tzinfo is None else created.astimezone(UTC)
    return OfficeFacts(
        snapshot=snapshot,
        resources=_resources(session, project_id, model_of(snapshot)),
        baseline=baseline,
        revision_date=created.strftime("%Y-%m-%dT%H:%M:%SZ"),
    )


def _runner_model(facts: OfficeFacts) -> dict[str, object]:
    model: Obj = deepcopy(model_of(facts.snapshot))
    for item in cast(list[Obj], model.get("resources", [])):
        digest = cast(str, cast(Obj, item["data"])["value"])[len(RESOURCE_URI_PREFIX) :]
        _, data = facts.resources[digest]
        item["data"] = {"kind": "bytes", "value": base64.b64encode(data).decode("ascii")}
    for section in cast(list[Obj], model.get("sections", [])):
        # An explicit empty header/footer makes the theme overlap the body in the PDF
        # converter (PDF_CONTENT_TOO_TALL); empty and absent are the same document.
        for key in ("header", "footer"):
            part = section.get(key)
            if isinstance(part, dict) and not any(
                part.get(variant) for variant in ("blocks", "firstPage", "evenPage")
            ):
                section.pop(key)
    return model


def _regenerate(facts: OfficeFacts) -> tuple[bytes, list[Obj]]:
    result = model_to_docx(_runner_model(facts))
    losses: list[Obj] = []
    for item in result.unsupported[:200]:
        kind = str(item.get("kind") or item.get("code") or "unsupported")[:80]
        losses.append(
            {
                "kind": kind,
                "path": str(item.get("path", ""))[:200],
                "label": "重新生成时该内容无法按原样写入 Word。",
            }
        )
    for protection in protections_of(facts.snapshot):
        if protection["kind"] == "object":
            losses.append(
                {
                    "kind": "object",
                    "path": cast(str, cast(Obj, protection["anchor"])["node"])[:200],
                    "label": "原件中的公式等对象未导入编辑器，重新生成的文档不含该对象；"
                    "需要完整对象请改用保留原件导出。",
                }
            )
    return result.docx, losses[:500]


def _preserve(
    client: OfficeServerClient, facts: OfficeFacts, track_changes: bool
) -> tuple[bytes, int, list[Obj]]:
    baseline = cast(OfficeBaseline, facts.baseline)
    plan = plan_preserve(model_of(baseline.snapshot), model_of(facts.snapshot), baseline.ir_map)
    unsupported = list(plan.unsupported)
    if not plan.ops:
        return baseline.original, 0, unsupported
    applied = client.transaction(
        baseline.original,
        {
            "mode": "apply",
            "author": AUTHOR,
            "date": facts.revision_date,
            "atomic": False,
            "ops": plan.ops,
        },
    )
    revisions: list[str] = []
    for result in applied.ops:
        op_id = str(result.get("id"))
        if result.get("status") == "applied":
            revision = result.get("revisionId")
            if isinstance(revision, str):
                revisions.append(revision)
            continue
        reason = str(result.get("reason") or result.get("status") or "rejected")[:40]
        unsupported.append(
            {
                "kind": "rejected",
                "node_id": plan.op_nodes.get(op_id),
                "detail": f"原件拒绝该段文字修改（{reason}），原件保持原样。",
            }
        )
    if applied.output is None:
        return baseline.original, 0, unsupported[:500]
    if track_changes or not revisions:
        return applied.output, len(revisions), unsupported[:500]
    accepted = client.transaction(
        applied.output,
        {
            "mode": "apply",
            "author": AUTHOR,
            "date": facts.revision_date,
            "atomic": True,
            "ops": [
                {"op": "revision.accept", "id": f"a{index}", "revisionId": revision}
                for index, revision in enumerate(revisions)
            ],
        },
    )
    if accepted.output is None or any(item.get("status") != "applied" for item in accepted.ops):
        raise AppError("OFFICE_CONFLICT", "原件修订无法合并为干净文档。", 409)
    return accepted.output, len(revisions), unsupported[:500]


def render_office(
    source: DocumentExportInput, facts: OfficeFacts, client: OfficeServerClient | None = None
) -> OfficeRendered:
    mode = cast(str, source.office_mode)
    warnings: tuple[OfficeWarning, ...] = ()
    total = 0
    unsupported: list[Obj] = []
    losses: list[Obj] = []
    applied = 0
    needs_client = mode == "preserve" or source.format == "pdf"
    office = client or (OfficeServerClient.from_settings() if needs_client else None)
    if mode == "preserve":
        docx, applied, unsupported = _preserve(
            cast(OfficeServerClient, office), facts, source.track_changes
        )
    else:
        docx, losses = _regenerate(facts)
    data = docx
    if source.format == "pdf":
        pdf = cast(OfficeServerClient, office).pdf(docx)
        data, warnings, total = pdf.data, pdf.warnings, pdf.warning_total
    report: dict[str, object] = {
        "mode": mode,
        "track_changes": source.track_changes,
        "baseline_version": facts.baseline.version if facts.baseline else None,
        "applied_changes": applied,
        "unsupported_changes": [
            {
                "kind": str(item["kind"])[:40],
                "node_id": cast(str | None, item.get("node_id")),
                "detail": str(item["detail"])[:400],
            }
            for item in unsupported
        ],
        "losses": losses,
        "warnings": [item.as_json() for item in warnings],
        "warning_total": total,
    }
    return OfficeRendered(data, report)


def revision_timestamp(value: datetime) -> str:
    value = value.replace(tzinfo=UTC) if value.tzinfo is None else value.astimezone(UTC)
    return value.strftime("%Y-%m-%dT%H:%M:%SZ")
