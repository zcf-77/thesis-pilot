"""Project-scoped immutable originals and parsing facts with explicit transactions."""

import base64
import binascii
import json
import re
from datetime import UTC, datetime
from hashlib import sha256
from typing import Literal, cast
from uuid import UUID

from sqlalchemy import func, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from thesis_pilot.core.errors import AppError
from thesis_pilot.modules.documents.structure import canonical_editor_json
from thesis_pilot.modules.jobs.models import Job
from thesis_pilot.modules.jobs.schemas import JobRead
from thesis_pilot.modules.jobs.service import enqueue_material_parse
from thesis_pilot.modules.materials.models import (
    Material,
    MaterialOriginal,
    MaterialParseVersion,
    ProjectSourceBinding,
    ProjectSourceBindingVersion,
)
from thesis_pilot.modules.materials.schemas import (
    MAX_ORIGINAL_BYTES,
    MaterialKind,
    MaterialOriginalCreate,
    MaterialOriginalPage,
    MaterialOriginalRead,
    MaterialPage,
    MaterialParseRead,
    MaterialParseSummary,
    MaterialParseSummaryPage,
    MaterialRead,
    MaterialReparse,
    MaterialUpdate,
    MaterialUpload,
    MaterialUploadReceipt,
    ProjectSourceBindingRead,
    ProjectSourceBindingUpdate,
    ProjectSourceBindingVersionPage,
    ProjectSourceBindingVersionRead,
)
from thesis_pilot.modules.projects.models import Project
from thesis_pilot.parsers.schemas import ParsedMaterial

MAX_PARSE_JSON_BYTES = 16 * 1024 * 1024


def error(code: str, message: str, status: int = 422) -> AppError:
    return AppError("MATERIAL_" + code, message, status)


def require_project(session: Session, project_id: UUID) -> None:
    if session.get(Project, project_id) is None:
        raise AppError("PROJECT_NOT_FOUND", "项目不存在。", 404)


def _material(
    session: Session, project_id: UUID, material_id: UUID, *, lock: bool = False
) -> Material:
    query = select(Material).where(Material.id == material_id, Material.project_id == project_id)
    if lock:
        query = query.with_for_update()
    material = session.scalar(query)
    if material is None:
        raise error("NOT_FOUND", "项目中没有该资料。", 404)
    return material


def _original(
    session: Session, project_id: UUID, material_id: UUID, original_id: UUID, *, lock: bool = False
) -> MaterialOriginal:
    _material(session, project_id, material_id)
    query = select(MaterialOriginal).where(
        MaterialOriginal.id == original_id, MaterialOriginal.material_id == material_id
    )
    if lock:
        query = query.with_for_update()
    original = session.scalar(query)
    if original is None:
        raise error("ORIGINAL_NOT_FOUND", "资料中没有该原件版本。", 404)
    return original


def _read_parse(version: MaterialParseVersion) -> MaterialParseRead:
    return MaterialParseRead(
        id=version.id,
        original_version_id=version.original_id,
        version=version.version,
        source_job_id=version.source_job_id,
        created_at=version.created_at,
        result=ParsedMaterial.model_validate(version.content),
    )


def _decode(data: MaterialUpload) -> bytes:
    try:
        content = base64.b64decode(data.content_base64, validate=True)
    except (ValueError, binascii.Error):
        raise error("BASE64_INVALID", "原件编码无效，请重新选择文件。") from None
    if not 1 <= len(content) <= MAX_ORIGINAL_BYTES:
        raise error("TOO_LARGE", "原件须为 1 字节至 8MiB。", 413)
    if base64.b64encode(content).decode("ascii") != data.content_base64:
        raise error("BASE64_INVALID", "原件编码不符合标准 base64。")
    suffix = data.filename.rsplit(".", 1)[-1].lower()
    expected = {"docx": {"docx"}, "pdf": {"pdf"}, "text": {"txt", "md", "text"}}
    if suffix not in expected[data.file_type]:
        raise error("FILE_TYPE_INVALID", "文件名扩展名与所选文件类型不一致。")
    if (data.file_type == "docx" and not content.startswith(b"PK")) or (
        data.file_type == "pdf" and not content.startswith(b"%PDF-")
    ):
        raise error("FILE_TYPE_INVALID", "文件内容与声明类型不一致。")
    return content


def _upload_key(project_id: UUID, key: str) -> str:
    if not re.fullmatch(r"[A-Za-z0-9._:-]{1,128}", key):
        raise error("UPLOAD_KEY_INVALID", "请提供有效的上传幂等键。")
    return "upload:" + sha256(f"{project_id}:{key}".encode()).hexdigest()


def _request_hash(
    project_id: UUID,
    material_id: UUID | None,
    data: MaterialUpload,
    digest: str,
    expected_version: int | None,
) -> str:
    payload = data.model_dump(exclude={"content_base64"})
    payload.update(
        project_id=str(project_id),
        material_id=str(material_id) if material_id else None,
        content_sha256=digest,
        expected_version=expected_version,
    )
    return sha256(json.dumps(payload, sort_keys=True, ensure_ascii=False).encode()).hexdigest()


def _receipt(
    session: Session, project_id: UUID, original: MaterialOriginal
) -> MaterialUploadReceipt:
    material = _material(session, project_id, original.material_id)
    job = session.get(Job, original.initial_job_id) if original.initial_job_id else None
    if job is None:
        raise error("UPLOAD_INCOMPLETE", "原件上传记录尚不完整，请重试查询。", 409)
    return MaterialUploadReceipt(
        material=MaterialRead.model_validate(material),
        original=MaterialOriginalRead.model_validate(original),
        job=JobRead.model_validate(job),
    )


def upload_material(
    session: Session,
    project_id: UUID,
    data: MaterialUpload,
    idempotency_key: str,
    material_id: UUID | None = None,
    expected_version: int | None = None,
) -> MaterialUploadReceipt:
    content = _decode(data)
    digest = sha256(content).hexdigest()
    key = _upload_key(project_id, idempotency_key)
    request_hash = _request_hash(project_id, material_id, data, digest, expected_version)
    try:
        with session.begin():
            require_project(session, project_id)
            existing = session.scalar(
                select(MaterialOriginal).where(MaterialOriginal.upload_key == key)
            )
            if existing is not None:
                if existing.request_hash != request_hash:
                    raise error("UPLOAD_KEY_CONFLICT", "上传幂等键已用于不同请求。", 409)
                return _receipt(session, project_id, existing)
            if material_id is None:
                material = Material(
                    project_id=project_id,
                    name=data.name,
                    kind=data.kind,
                    source_note=data.source_note,
                )
                session.add(material)
                session.flush()
            else:
                material = _material(session, project_id, material_id, lock=True)
                if material.version != expected_version:
                    raise error("VERSION_CONFLICT", "资料已修改，请重新读取后保存。", 409)
                material.name, material.kind, material.source_note = (
                    data.name,
                    data.kind,
                    data.source_note,
                )
                material.version += 1
                material.updated_at = datetime.now(UTC)
            number = (
                session.scalar(
                    select(func.max(MaterialOriginal.version)).where(
                        MaterialOriginal.material_id == material.id
                    )
                )
                or 0
            ) + 1
            original = MaterialOriginal(
                material_id=material.id,
                version=number,
                filename=data.filename,
                file_type=data.file_type,
                sha256=digest,
                byte_size=len(content),
                data=content,
                upload_key=key,
                request_hash=request_hash,
            )
            session.add(original)
            session.flush()
            material.current_original_id = original.id
            job = enqueue_material_parse(
                session,
                project_id,
                material.id,
                original.id,
                digest,
                None,
                "material:" + sha256(key.encode()).hexdigest(),
            )
            original.initial_job_id = job.id
            session.flush()
            return _receipt(session, project_id, original)
    except IntegrityError:
        # Another identical upload may have won the unique key. The entire losing
        # transaction (including its original, Job and outbox) has rolled back.
        with session.begin():
            existing = session.scalar(
                select(MaterialOriginal).where(MaterialOriginal.upload_key == key)
            )
            if existing is not None:
                if existing.request_hash != request_hash:
                    raise error("UPLOAD_KEY_CONFLICT", "上传幂等键已用于不同请求。", 409) from None
                return _receipt(session, project_id, existing)
        raise


def append_original(
    session: Session,
    project_id: UUID,
    material_id: UUID,
    data: MaterialOriginalCreate,
    idempotency_key: str,
) -> MaterialUploadReceipt:
    upload = MaterialUpload.model_validate(data.model_dump(exclude={"expected_version"}))
    return upload_material(
        session, project_id, upload, idempotency_key, material_id, data.expected_version
    )


def list_materials(
    session: Session,
    project_id: UUID,
    *,
    limit: int,
    offset: int,
    kind: MaterialKind | None = None,
    include_removed: bool = False,
) -> MaterialPage:
    with session.begin():
        require_project(session, project_id)
        conditions = [Material.project_id == project_id]
        if kind is not None:
            conditions.append(Material.kind == kind)
        if not include_removed:
            conditions.append(Material.removed.is_(False))
        items = session.scalars(
            select(Material)
            .where(*conditions)
            .order_by(Material.created_at.desc(), Material.id.desc())
            .limit(limit)
            .offset(offset)
        ).all()
        return MaterialPage(
            items=[MaterialRead.model_validate(item) for item in items],
            total=session.scalar(select(func.count()).select_from(Material).where(*conditions))
            or 0,
            limit=limit,
            offset=offset,
        )


def get_material(session: Session, project_id: UUID, material_id: UUID) -> MaterialRead:
    with session.begin():
        return MaterialRead.model_validate(_material(session, project_id, material_id))


def update_material(
    session: Session, project_id: UUID, material_id: UUID, data: MaterialUpdate
) -> MaterialRead:
    with session.begin():
        _material(session, project_id, material_id)
        material = session.scalars(
            update(Material)
            .where(
                Material.id == material_id,
                Material.project_id == project_id,
                Material.version == data.expected_version,
            )
            .values(
                **data.model_dump(exclude_unset=True, exclude={"expected_version"}),
                version=Material.version + 1,
                updated_at=datetime.now(UTC),
            )
            .returning(Material)
            .execution_options(synchronize_session=False, populate_existing=True)
        ).one_or_none()
        if material is None:
            raise error("VERSION_CONFLICT", "资料已修改，请重新读取后保存。", 409)
        return MaterialRead.model_validate(material)


def list_originals(
    session: Session, project_id: UUID, material_id: UUID, *, limit: int, offset: int
) -> MaterialOriginalPage:
    with session.begin():
        _material(session, project_id, material_id)
        items = session.scalars(
            select(MaterialOriginal)
            .where(MaterialOriginal.material_id == material_id)
            .order_by(MaterialOriginal.version.desc())
            .limit(limit)
            .offset(offset)
        ).all()
        return MaterialOriginalPage(
            items=[MaterialOriginalRead.model_validate(item) for item in items],
            total=session.scalar(
                select(func.count())
                .select_from(MaterialOriginal)
                .where(MaterialOriginal.material_id == material_id)
            )
            or 0,
            limit=limit,
            offset=offset,
        )


def get_original(
    session: Session, project_id: UUID, material_id: UUID, original_id: UUID
) -> MaterialOriginalRead:
    with session.begin():
        return MaterialOriginalRead.model_validate(
            _original(session, project_id, material_id, original_id)
        )


def get_original_bytes(
    session: Session, project_id: UUID, material_id: UUID, original_id: UUID
) -> tuple[MaterialOriginalRead, bytes]:
    with session.begin():
        original = _original(session, project_id, material_id, original_id)
        content = original.data
        if len(content) != original.byte_size or sha256(content).hexdigest() != original.sha256:
            raise error("ORIGINAL_CORRUPT", "原件字节与保存的摘要不一致。")
        return MaterialOriginalRead.model_validate(original), content


def load_material_parse_source(
    session: Session,
    project_id: UUID,
    material_id: UUID,
    original_version_id: UUID,
    *,
    for_update: bool = False,
) -> dict[str, object]:
    """Caller owns transaction. Bytes never cross an ordinary read DTO."""
    original = _original(session, project_id, material_id, original_version_id, lock=for_update)
    content = original.data
    if len(content) != original.byte_size or sha256(content).hexdigest() != original.sha256:
        raise error("ORIGINAL_CORRUPT", "原件字节与保存的摘要不一致。")
    return {
        "data": content,
        "sha256": original.sha256,
        "filename": original.filename,
        "file_type": original.file_type,
        "expected_parse_id": original.latest_parse_id,
    }


def reparse_material(
    session: Session,
    project_id: UUID,
    material_id: UUID,
    original_id: UUID,
    data: MaterialReparse,
    idempotency_key: str,
) -> JobRead:
    with session.begin():
        original = _original(session, project_id, material_id, original_id, lock=True)
        key = "reparse:" + _upload_key(project_id, idempotency_key).split(":", 1)[1]
        existing = session.scalar(select(Job).where(Job.idempotency_key == key))
        if existing is not None:
            source = existing.input_snapshot or {}
            expected = str(data.expected_parse_id) if data.expected_parse_id else None
            if (
                existing.project_id != project_id
                or source.get("original_version_id") != str(original_id)
                or source.get("expected_parse_id") != expected
            ):
                raise error("UPLOAD_KEY_CONFLICT", "解析幂等键已用于不同请求。", 409)
            return JobRead.model_validate(existing)
        if original.latest_parse_id != data.expected_parse_id:
            raise error("PARSE_CONFLICT", "解析版本已变化，请重新读取后再解析。", 409)
        return JobRead.model_validate(
            enqueue_material_parse(
                session,
                project_id,
                material_id,
                original_id,
                original.sha256,
                data.expected_parse_id,
                key,
            )
        )


def commit_material_parse(
    session: Session,
    project_id: UUID,
    material_id: UUID,
    original_version_id: UUID,
    expected_parse_id: UUID | None,
    job_id: UUID,
    parsed_payload: object,
) -> MaterialParseRead:
    """Called only inside Job's current-token/lease transaction; never commits."""
    original = _original(session, project_id, material_id, original_version_id, lock=True)
    parsed = (
        parsed_payload
        if isinstance(parsed_payload, ParsedMaterial)
        else ParsedMaterial.model_validate(parsed_payload)
    )
    wire = json.dumps(parsed.model_dump(mode="json"), ensure_ascii=False, allow_nan=False).encode()
    if len(wire) > MAX_PARSE_JSON_BYTES:
        raise error("PARSE_LIMIT_EXCEEDED", "解析结果超过大小限制。", 413)
    if parsed.editor_json is not None:
        canonical_editor_json(parsed.editor_json)
    anchors = {anchor.id: anchor for anchor in parsed.anchors}
    if len(anchors) != len(parsed.anchors) or any(
        anchor.original_version_id != original_version_id
        or sha256(anchor.original_text.encode()).hexdigest() != anchor.sha256
        for anchor in parsed.anchors
    ):
        raise error("PARSE_INVALID", "解析锚点身份或原句摘要不符合固定原件。")
    for anchor_ids in [item.anchor_ids for item in parsed.template_items] + [
        item.anchor_ids for item in parsed.requirements
    ]:
        if any(anchor_id not in anchors for anchor_id in anchor_ids):
            raise error("PARSE_INVALID", "解析结果引用了不存在的来源锚点。")
    previous = session.scalar(
        select(MaterialParseVersion).where(MaterialParseVersion.source_job_id == job_id)
    )
    if previous is not None:
        if previous.original_id != original_version_id or previous.content != parsed.model_dump(
            mode="json"
        ):
            raise error("PARSE_CONFLICT", "同一任务已经保存了不同的解析结果。", 409)
        return _read_parse(previous)
    if original.latest_parse_id != expected_parse_id:
        raise error("PARSE_CONFLICT", "解析版本已变化，迟到结果未替换当前版本。", 409)
    job = session.get(Job, job_id)
    if (
        job is None
        or job.project_id != project_id
        or job.kind != "material_parse"
        or (job.input_snapshot or {}).get("material_id") != str(material_id)
        or (job.input_snapshot or {}).get("original_version_id") != str(original_version_id)
        or (job.input_snapshot or {}).get("original_sha256") != original.sha256
    ):
        raise error("PARSE_INVALID", "解析任务与项目不一致。")
    number = (
        session.scalar(
            select(func.max(MaterialParseVersion.version)).where(
                MaterialParseVersion.original_id == original_version_id
            )
        )
        or 0
    ) + 1
    version = MaterialParseVersion(
        original_id=original_version_id,
        version=number,
        status=parsed.status,
        source_job_id=job_id,
        content=parsed.model_dump(mode="json"),
    )
    session.add(version)
    session.flush()
    changed = session.scalar(
        update(MaterialOriginal)
        .where(
            MaterialOriginal.id == original_version_id,
            MaterialOriginal.latest_parse_id == expected_parse_id,
        )
        .values(latest_parse_id=version.id)
        .returning(MaterialOriginal.id)
        .execution_options(synchronize_session=False)
    )
    if changed is None:
        raise error("PARSE_CONFLICT", "解析版本已变化，迟到结果未替换当前版本。", 409)
    session.expire(original, ["latest_parse_id"])
    return _read_parse(version)


def list_parses(
    session: Session,
    project_id: UUID,
    material_id: UUID,
    original_id: UUID,
    *,
    limit: int,
    offset: int,
) -> MaterialParseSummaryPage:
    with session.begin():
        _original(session, project_id, material_id, original_id)
        versions = session.scalars(
            select(MaterialParseVersion)
            .where(MaterialParseVersion.original_id == original_id)
            .order_by(MaterialParseVersion.version.desc())
            .limit(limit)
            .offset(offset)
        ).all()
        return MaterialParseSummaryPage(
            items=[
                MaterialParseSummary(
                    id=version.id,
                    original_version_id=version.original_id,
                    version=version.version,
                    status=cast(Literal["complete", "partial"], version.status),
                    source_job_id=version.source_job_id,
                    created_at=version.created_at,
                )
                for version in versions
            ],
            total=session.scalar(
                select(func.count())
                .select_from(MaterialParseVersion)
                .where(MaterialParseVersion.original_id == original_id)
            )
            or 0,
            limit=limit,
            offset=offset,
        )


def get_parse(
    session: Session, project_id: UUID, material_id: UUID, original_id: UUID, parse_id: UUID
) -> MaterialParseRead:
    with session.begin():
        _original(session, project_id, material_id, original_id)
        version = session.get(MaterialParseVersion, parse_id)
        if version is None or version.original_id != original_id:
            raise error("PARSE_NOT_FOUND", "原件中没有该解析版本。", 404)
        return _read_parse(version)


def _scoped_parse(
    session: Session, project_id: UUID, parse_id: UUID
) -> tuple[Material, MaterialOriginal, MaterialParseVersion]:
    pair = session.execute(
        select(Material, MaterialOriginal, MaterialParseVersion)
        .join(MaterialOriginal, MaterialOriginal.material_id == Material.id)
        .join(MaterialParseVersion, MaterialParseVersion.original_id == MaterialOriginal.id)
        .where(
            Material.project_id == project_id,
            MaterialParseVersion.id == parse_id,
        )
    ).one_or_none()
    if pair is None:
        raise error("BINDING_INVALID", "解析版本不属于当前项目。")
    return pair[0], pair[1], pair[2]


def _binding_read(session: Session, project_id: UUID) -> ProjectSourceBindingRead:
    root = session.get(ProjectSourceBinding, project_id)
    if root is None:
        return ProjectSourceBindingRead(
            project_id=project_id,
            version=0,
            current_version_id=None,
            template_parse_version_id=None,
            requirement_parse_version_ids=[],
            updated_at=None,
        )
    snapshot = session.get(ProjectSourceBindingVersion, root.current_version_id)
    if snapshot is None:
        raise error("BINDING_INVALID", "来源绑定版本不存在。")
    return ProjectSourceBindingRead(
        project_id=project_id,
        version=root.version,
        current_version_id=snapshot.id,
        template_parse_version_id=snapshot.template_parse_version_id,
        requirement_parse_version_ids=[
            UUID(value) for value in snapshot.requirement_parse_version_ids
        ],
        updated_at=root.updated_at,
    )


def get_binding(session: Session, project_id: UUID) -> ProjectSourceBindingRead:
    with session.begin():
        require_project(session, project_id)
        return _binding_read(session, project_id)


def update_binding(
    session: Session, project_id: UUID, data: ProjectSourceBindingUpdate
) -> ProjectSourceBindingRead:
    try:
        with session.begin():
            # Serialize first binding creation as well as later version updates.
            project = session.scalar(
                select(Project).where(Project.id == project_id).with_for_update()
            )
            if project is None:
                raise AppError("PROJECT_NOT_FOUND", "项目不存在。", 404)
            root = session.get(ProjectSourceBinding, project_id)
            if (root.version if root else 0) != data.expected_version:
                raise error("BINDING_CONFLICT", "项目来源绑定已修改，请重新读取。", 409)
            chosen = [*data.requirement_parse_version_ids]
            if data.template_parse_version_id is not None:
                chosen.append(data.template_parse_version_id)
            for parse_id in set(chosen):
                material, _, parsed = _scoped_parse(session, project_id, parse_id)
                if not material.linked or material.removed:
                    raise error("BINDING_INVALID", "已解绑或移除的资料不能用于新的来源绑定。")
                if parse_id == data.template_parse_version_id and material.kind != "template":
                    raise error("BINDING_INVALID", "模板绑定必须引用模板资料的解析版本。")
                if parse_id in data.requirement_parse_version_ids and (
                    material.kind not in {"template", "requirements"}
                    or not ParsedMaterial.model_validate(parsed.content).requirements
                ):
                    raise error("BINDING_INVALID", "要求来源需包含可追溯的要求条目。")
            if root is None:
                root = ProjectSourceBinding(project_id=project_id)
                session.add(root)
                session.flush()
            else:
                root.version += 1
            snapshot = ProjectSourceBindingVersion(
                project_id=project_id,
                version=root.version,
                template_parse_version_id=data.template_parse_version_id,
                requirement_parse_version_ids=[
                    str(value) for value in data.requirement_parse_version_ids
                ],
            )
            session.add(snapshot)
            session.flush()
            root.current_version_id = snapshot.id
            root.updated_at = datetime.now(UTC)
            session.flush()
            return _binding_read(session, project_id)
    except IntegrityError:
        raise error("BINDING_CONFLICT", "项目来源绑定已修改，请重新读取。", 409) from None


def list_binding_versions(
    session: Session, project_id: UUID, *, limit: int, offset: int
) -> ProjectSourceBindingVersionPage:
    with session.begin():
        require_project(session, project_id)
        versions = session.scalars(
            select(ProjectSourceBindingVersion)
            .where(ProjectSourceBindingVersion.project_id == project_id)
            .order_by(ProjectSourceBindingVersion.version.desc())
            .limit(limit)
            .offset(offset)
        ).all()
        return ProjectSourceBindingVersionPage(
            items=[ProjectSourceBindingVersionRead.model_validate(item) for item in versions],
            total=session.scalar(
                select(func.count())
                .select_from(ProjectSourceBindingVersion)
                .where(ProjectSourceBindingVersion.project_id == project_id)
            )
            or 0,
            limit=limit,
            offset=offset,
        )


def get_binding_version(
    session: Session, project_id: UUID, version: int
) -> ProjectSourceBindingVersionRead:
    with session.begin():
        require_project(session, project_id)
        snapshot = session.scalar(
            select(ProjectSourceBindingVersion).where(
                ProjectSourceBindingVersion.project_id == project_id,
                ProjectSourceBindingVersion.version == version,
            )
        )
        if snapshot is None:
            raise error("BINDING_NOT_FOUND", "来源绑定版本不存在。", 404)
        return ProjectSourceBindingVersionRead.model_validate(snapshot)


def freeze_project_sources(session: Session, project_id: UUID) -> dict[str, object]:
    """Caller owns transaction; historical bindings remain traceable after removal."""
    require_project(session, project_id)
    binding = _binding_read(session, project_id)
    result: dict[str, object] = {
        "binding": binding.model_dump(mode="json"),
        "template": None,
        "requirements": [],
    }
    sources: list[dict[str, object]] = []
    source_bytes = 0
    for parse_id in binding.requirement_parse_version_ids:
        _, original, parsed = _scoped_parse(session, project_id, parse_id)
        payload = ParsedMaterial.model_validate(parsed.content)
        wanted_anchors = {key for item in payload.requirements for key in item.anchor_ids}
        sources.append(
            {
                "parse_version_id": str(parsed.id),
                "original_version_id": str(original.id),
                "sha256": original.sha256,
                "items": [item.model_dump(mode="json") for item in payload.requirements],
                "anchors": [
                    anchor.model_dump(mode="json")
                    for anchor in payload.anchors
                    if anchor.id in wanted_anchors
                ],
            }
        )
        source_bytes += len(json.dumps(sources[-1], ensure_ascii=False).encode())
        if source_bytes > 2 * 1024 * 1024:
            raise error("SOURCES_TOO_LARGE", "绑定来源过大，请明确选择较小的适用范围。", 413)
    result["requirements"] = sources
    if binding.template_parse_version_id is not None:
        _, original, parsed = _scoped_parse(session, project_id, binding.template_parse_version_id)
        payload = ParsedMaterial.model_validate(parsed.content)
        wanted_anchors = {key for item in payload.template_items for key in item.anchor_ids}
        result["template"] = {
            "parse_version_id": str(parsed.id),
            "original_version_id": str(original.id),
            "sha256": original.sha256,
            "items": [item.model_dump(mode="json") for item in payload.template_items],
            "anchors": [
                anchor.model_dump(mode="json")
                for anchor in payload.anchors
                if anchor.id in wanted_anchors
            ],
        }
    if len(json.dumps(result, ensure_ascii=False, allow_nan=False).encode()) > 2 * 1024 * 1024:
        raise error("SOURCES_TOO_LARGE", "绑定来源过大，请明确选择较小的适用范围。", 413)
    return result
