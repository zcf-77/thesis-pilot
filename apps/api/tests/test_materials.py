"""SG-06A original, transaction, scope and fixed parsing/binding regressions."""

import base64
from hashlib import sha256
from uuid import uuid4

import pytest
from pydantic import ValidationError
from sqlalchemy import func, inspect, select, update
from sqlalchemy.orm import Session, sessionmaker

from thesis_pilot.core.errors import AppError
from thesis_pilot.modules.jobs.models import Job, OutboxEvent
from thesis_pilot.modules.materials import service
from thesis_pilot.modules.materials.models import Material, MaterialOriginal
from thesis_pilot.modules.materials.schemas import (
    MAX_ORIGINAL_BYTES,
    MaterialOriginalCreate,
    MaterialReparse,
    MaterialUpdate,
    MaterialUpload,
    ProjectSourceBindingUpdate,
)
from thesis_pilot.modules.projects.schemas import ProjectCreate
from thesis_pilot.modules.projects.service import create_project
from thesis_pilot.parsers.materials import parse_original


def upload(text: str = "正文不少于1000字。", **changes: object) -> MaterialUpload:
    data = {
        "name": "自制资料",
        "filename": "合成规范.txt",
        "file_type": "text",
        "kind": "requirements",
        "source_note": "仅自制测试",
        "content_base64": base64.b64encode(text.encode()).decode(),
        **changes,
    }
    return MaterialUpload.model_validate(data)


def project(session: Session):
    return create_project(session, ProjectCreate(name="自制资料项目"))


def test_upload_replay_keeps_one_original_job_and_outbox_and_download_exact_bytes(
    session_factory: sessionmaker[Session],
) -> None:
    with session_factory() as session:
        owner = project(session)
        original = service.upload_material(session, owner.id, upload(), "fixed-upload")
        replay = service.upload_material(session, owner.id, upload(), "fixed-upload")
        assert original == replay
        info, raw = service.get_original_bytes(
            session, owner.id, original.material.id, original.original.id
        )
        assert raw == "正文不少于1000字。".encode()
        assert info.sha256 == sha256(raw).hexdigest() and info.byte_size == len(raw)
        assert "data" not in info.model_dump() and "content_base64" not in original.model_dump()
        with session.begin():
            assert session.scalar(select(func.count()).select_from(Material)) == 1
            assert session.scalar(select(func.count()).select_from(MaterialOriginal)) == 1
            assert session.scalar(select(func.count()).select_from(Job)) == 1
            assert session.scalar(select(func.count()).select_from(OutboxEvent)) == 1


def test_upload_key_conflict_and_enqueue_failure_leave_no_partial_original(
    session_factory: sessionmaker[Session], monkeypatch: pytest.MonkeyPatch
) -> None:
    with session_factory() as session:
        owner = project(session)
        original = service.upload_material(session, owner.id, upload(), "one")
        with pytest.raises(AppError) as conflict:
            service.upload_material(session, owner.id, upload("不同原件"), "one")
        assert conflict.value.code == "MATERIAL_UPLOAD_KEY_CONFLICT"

        def fail_enqueue(*args: object, **kwargs: object) -> None:
            raise RuntimeError("synthetic enqueue failure")

        monkeypatch.setattr(service, "enqueue_material_parse", fail_enqueue)
        with pytest.raises(RuntimeError, match="synthetic enqueue"):
            service.upload_material(session, owner.id, upload("第二份自制资料"), "two")
        assert service.get_material(session, owner.id, original.material.id) == original.material
        with session.begin():
            assert session.scalar(select(func.count()).select_from(MaterialOriginal)) == 1
            assert session.scalar(select(func.count()).select_from(Job)) == 1
            assert session.scalar(select(func.count()).select_from(OutboxEvent)) == 1


def test_append_and_metadata_cas_preserve_old_original_and_project_scope(
    session_factory: sessionmaker[Session],
) -> None:
    with session_factory() as session:
        owner, other = project(session), project(session)
        first = service.upload_material(session, owner.id, upload("初版资料"), "v1")
        second_data = MaterialOriginalCreate.model_validate(
            {**upload("新版资料").model_dump(), "expected_version": 1}
        )
        second = service.append_original(session, owner.id, first.material.id, second_data, "v2")
        assert second.material.version == second.original.version == 2
        assert (
            service.get_original_bytes(session, owner.id, first.material.id, first.original.id)[1]
            == "初版资料".encode()
        )
        with pytest.raises(AppError) as stale:
            service.append_original(session, owner.id, first.material.id, second_data, "v3")
        assert stale.value.code == "MATERIAL_VERSION_CONFLICT"
        with pytest.raises(AppError) as scoped:
            service.get_original_bytes(session, other.id, first.material.id, first.original.id)
        assert scoped.value.code == "MATERIAL_NOT_FOUND"
        changed = service.update_material(
            session,
            owner.id,
            first.material.id,
            MaterialUpdate(expected_version=2, name="重命名", linked=False, removed=True),
        )
        assert changed.current_original_id == second.original.id
        assert service.list_materials(session, owner.id, limit=20, offset=0).total == 0
        assert (
            service.list_materials(
                session, owner.id, limit=20, offset=0, include_removed=True
            ).total
            == 1
        )
        assert (
            service.list_originals(session, owner.id, first.material.id, limit=1, offset=1)
            .items[0]
            .id
            == first.original.id
        )


@pytest.mark.parametrize(
    "filename", ["../private.txt", "C:\\private.txt", "bad\r\n.txt", "bad\x00.txt"]
)
def test_upload_filename_is_metadata_not_a_client_path(filename: str) -> None:
    with pytest.raises(ValidationError):
        upload(filename=filename)


def test_strict_base64_and_original_size_limits_do_not_write(
    session_factory: sessionmaker[Session],
) -> None:
    with session_factory() as session:
        owner = project(session)
        for encoded in ("====", "YWJj\n", "YWJj!!"):
            with pytest.raises(AppError) as invalid:
                service.upload_material(
                    session, owner.id, upload(content_base64=encoded), str(uuid4())
                )
            assert invalid.value.code == "MATERIAL_BASE64_INVALID"
        too_large = base64.b64encode(b"a" * (MAX_ORIGINAL_BYTES + 1)).decode()
        with pytest.raises(AppError) as large:
            service.upload_material(session, owner.id, upload(content_base64=too_large), "oversize")
        assert large.value.status_code == 413
        with session.begin():
            assert session.scalar(select(func.count()).select_from(MaterialOriginal)) == 0


def test_deferred_original_bytes_are_not_loaded_for_metadata_pages(
    session_factory: sessionmaker[Session],
) -> None:
    with session_factory() as session:
        owner = project(session)
        receipt = service.upload_material(session, owner.id, upload(), "deferred")
    with session_factory() as session:
        original = session.get(MaterialOriginal, receipt.original.id)
        assert "data" in inspect(original).unloaded
        session.rollback()
        page = service.list_originals(session, owner.id, receipt.material.id, limit=20, offset=0)
        assert page.total == 1
        assert "data" in inspect(original).unloaded


def test_parse_commit_is_idempotent_and_late_expected_pointer_cannot_replace_result(
    session_factory: sessionmaker[Session],
) -> None:
    with session_factory() as session:
        owner = project(session)
        receipt = service.upload_material(session, owner.id, upload(), "source")
        retry = service.reparse_material(
            session,
            owner.id,
            receipt.material.id,
            receipt.original.id,
            MaterialReparse(expected_parse_id=None),
            "parallel-parse",
        )
        parsed = parse_original("正文不少于1000字。".encode(), receipt.original.id, "text")
        with session.begin():
            first = service.commit_material_parse(
                session,
                owner.id,
                receipt.material.id,
                receipt.original.id,
                None,
                receipt.job.id,
                parsed,
            )
        with session.begin():
            replay = service.commit_material_parse(
                session,
                owner.id,
                receipt.material.id,
                receipt.original.id,
                None,
                receipt.job.id,
                parsed,
            )
        assert replay == first
        with pytest.raises(AppError) as late, session.begin():
            service.commit_material_parse(
                session,
                owner.id,
                receipt.material.id,
                receipt.original.id,
                None,
                retry.id,
                parsed,
            )
        assert late.value.code == "MATERIAL_PARSE_CONFLICT"
        assert (
            service.get_original(
                session, owner.id, receipt.material.id, receipt.original.id
            ).latest_parse_id
            == first.id
        )
        assert (
            service.list_parses(
                session, owner.id, receipt.material.id, receipt.original.id, limit=20, offset=0
            ).total
            == 1
        )


def test_binding_pins_real_requirements_and_keeps_history_after_unlink(
    session_factory: sessionmaker[Session],
) -> None:
    with session_factory() as session:
        owner, other = project(session), project(session)
        receipt = service.upload_material(session, owner.id, upload(), "binding-source")
        parsed = parse_original("正文不少于1000字。".encode(), receipt.original.id, "text")
        assert parsed.requirements
        with session.begin():
            version = service.commit_material_parse(
                session,
                owner.id,
                receipt.material.id,
                receipt.original.id,
                None,
                receipt.job.id,
                parsed,
            )
        bound = service.update_binding(
            session,
            owner.id,
            ProjectSourceBindingUpdate(
                expected_version=0,
                template_parse_version_id=None,
                requirement_parse_version_ids=[version.id],
            ),
        )
        assert bound.version == 1
        with pytest.raises(AppError) as foreign:
            service.update_binding(
                session,
                other.id,
                ProjectSourceBindingUpdate(
                    expected_version=0,
                    template_parse_version_id=None,
                    requirement_parse_version_ids=[version.id],
                ),
            )
        assert foreign.value.code == "MATERIAL_BINDING_INVALID"
        with pytest.raises(AppError) as stale:
            service.update_binding(
                session,
                owner.id,
                ProjectSourceBindingUpdate(
                    expected_version=0,
                    template_parse_version_id=None,
                    requirement_parse_version_ids=[],
                ),
            )
        assert stale.value.code == "MATERIAL_BINDING_CONFLICT"
        service.update_material(
            session,
            owner.id,
            receipt.material.id,
            MaterialUpdate(expected_version=1, linked=False, removed=True),
        )
        with session.begin():
            frozen = service.freeze_project_sources(session, owner.id)
        assert frozen["binding"]["current_version_id"] == str(bound.current_version_id)
        assert service.get_binding_version(session, owner.id, 1).requirement_parse_version_ids == [
            version.id
        ]


def test_corrupt_original_is_refused_before_download_or_worker_use(
    session_factory: sessionmaker[Session],
) -> None:
    with session_factory() as session:
        owner = project(session)
        receipt = service.upload_material(session, owner.id, upload(), "corrupt")
        with session.begin():
            session.execute(
                update(MaterialOriginal)
                .where(MaterialOriginal.id == receipt.original.id)
                .values(data=b"changed")
            )
        with pytest.raises(AppError) as corrupt:
            service.get_original_bytes(session, owner.id, receipt.material.id, receipt.original.id)
        assert corrupt.value.code == "MATERIAL_ORIGINAL_CORRUPT"
