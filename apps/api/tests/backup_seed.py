"""Synthetic project with many object types for SG-14 backup/restore tests (no real thesis data)."""

import base64
import struct
import zlib
from dataclasses import dataclass
from uuid import UUID, uuid4

from sqlalchemy import select
from sqlalchemy.orm import Session, sessionmaker

from thesis_pilot.modules.assistant_sessions import service as assistant
from thesis_pilot.modules.assistant_sessions.schemas import AssistantSessionCreate
from thesis_pilot.modules.documents import resources
from thesis_pilot.modules.documents import service as documents
from thesis_pilot.modules.documents.schemas import (
    DocumentImport,
    DocumentResourceUpload,
    DocumentSave,
    DocumentSchemaUpgradeCreate,
)
from thesis_pilot.modules.exports import service as exports
from thesis_pilot.modules.exports.schemas import DocumentExportCreate
from thesis_pilot.modules.feedback import service as feedback
from thesis_pilot.modules.feedback.schemas import FeedbackCreate, FeedbackItemCreate
from thesis_pilot.modules.jobs import service as jobs
from thesis_pilot.modules.jobs.schemas import JobCreate
from thesis_pilot.modules.literature import service as literature
from thesis_pilot.modules.literature.schemas import LiteratureSearchCreate
from thesis_pilot.modules.materials import service as materials
from thesis_pilot.modules.materials.models import MaterialOriginal
from thesis_pilot.modules.materials.schemas import MaterialUpload, ProjectSourceBindingUpdate
from thesis_pilot.modules.notifications import service as notifications
from thesis_pilot.modules.plans import service as plans
from thesis_pilot.modules.plans.schemas import PlanSchedule
from thesis_pilot.modules.project_flows import service as flows
from thesis_pilot.modules.project_flows.schemas import FlowCreate
from thesis_pilot.modules.projects.models import Project
from thesis_pilot.modules.projects.schemas import ProjectCreate
from thesis_pilot.modules.projects.service import create_project
from thesis_pilot.modules.revisions import service as revisions
from thesis_pilot.modules.revisions.schemas import (
    RevisionApply,
    RevisionCreate,
    RevisionDecide,
    RevisionProposal,
)
from thesis_pilot.modules.stage_confirmations import service as stages
from thesis_pilot.modules.stage_confirmations.schemas import StageConfirm
from thesis_pilot.modules.tasks import service as tasks
from thesis_pilot.modules.tasks.schemas import TaskContent, TaskCreate
from thesis_pilot.workers.execution import execute_job

HEADING = "自制论文 <标题>"
BODY = "采用方法甲。能够验证。"
MATERIAL_TEXT = "自制规范：正文不少于一千字，参考文献按国标著录。"


def png(width: int = 2, height: int = 3) -> bytes:
    def chunk(kind: bytes, data: bytes) -> bytes:
        return (
            struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data))
        )

    raw = b"".join(b"\x00" + b"\x00\x00\x00" * width for _ in range(height))
    header = struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0)
    return (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", header)
        + chunk(b"IDAT", zlib.compress(raw))
        + chunk(b"IEND", b"")
    )


def manuscript(body: str = BODY) -> dict[str, object]:
    return {
        "schema_version": 1,
        "json": {
            "type": "doc",
            "content": [
                {
                    "type": "heading",
                    "attrs": {"level": 1, "chapterId": "c1"},
                    "content": [{"type": "text", "text": HEADING}],
                },
                {"type": "paragraph", "content": [{"type": "text", "text": body}]},
            ],
        },
    }


STAGES = [
    {
        "id": "proposal",
        "name": "开题",
        "description": "明确研究范围。",
        "deliverables": ["开题报告"],
        "conditions": ["本人确认范围与来源"],
        "dependencies": [],
        "deadline": "2026-11-01",
    },
    {
        "id": "writing",
        "name": "论文撰写",
        "deliverables": ["论文初稿"],
        "conditions": ["本人核对初稿"],
        "dependencies": ["proposal"],
        "deadline": "2026-11-18",
    },
]


@dataclass(frozen=True)
class Seeded:
    project_id: UUID
    document_id: UUID
    task_id: UUID
    material_id: UUID
    queued_job_id: UUID
    resource_sha256: str


def _adopt(session: Session, project_id: UUID, document_id: UUID, base: int) -> None:
    length = len(BODY.encode("utf-16-le")) // 2
    start = len(HEADING) + 2 + 1
    created = revisions.create_revision(
        session,
        project_id,
        document_id,
        RevisionCreate.model_validate(
            {
                "command_id": str(uuid4()),
                "base_version": base,
                "selection": {
                    "textblock_path": [1],
                    "from": start,
                    "to": start + length,
                    "text": BODY,
                },
                "goal": "精简表述",
            }
        ),
    )
    assert created.candidate_id is not None
    item = revisions.get_revision(session, project_id, document_id, created.candidate_id)
    revisions.submit_proposal(
        session,
        project_id,
        document_id,
        item.id,
        RevisionProposal.model_validate(
            {
                "command_id": str(uuid4()),
                "generation_token": str(item.generation_token),
                "patches": [
                    {
                        "id": "p1",
                        "from": start,
                        "to": start + 3,
                        "before": "采用方",
                        "after": "使用方",
                    }
                ],
            }
        ),
    )
    revisions.decide_revision(
        session,
        project_id,
        document_id,
        item.id,
        RevisionDecide.model_validate(
            {
                "command_id": str(uuid4()),
                "expected_revision": 2,
                "decisions": [{"patch_id": "p1", "decision": "accepted"}],
            }
        ),
    )
    revisions.apply_revision(
        session,
        project_id,
        document_id,
        item.id,
        RevisionApply(command_id=uuid4(), expected_revision=3, expected_document_version=base),
    )


def seed_project(sessions: sessionmaker[Session], *, name: str = "备份合成项目") -> Seeded:
    with sessions() as session:
        flow = flows.create_flow(
            session, FlowCreate.model_validate({"name": "自制流程", "stages": STAGES})
        )
    with sessions() as session:
        project = create_project(
            session,
            ProjectCreate(name=name, flow_version_id=flow.current_version_id, stage_id="proposal"),
        )
    pid = project.id
    with sessions() as session:
        document = documents.import_document(
            session, pid, DocumentImport.model_validate({"content": manuscript()})
        )
    with sessions() as session:
        documents.save_document(
            session,
            pid,
            document.id,
            DocumentSave.model_validate({"content": manuscript(BODY), "expected_version": 1}),
        )
    with sessions() as session:
        _adopt(session, pid, document.id, 2)
    with sessions() as session:
        documents.upgrade_schema(
            session,
            pid,
            document.id,
            DocumentSchemaUpgradeCreate(command_id=uuid4(), expected_version=3),
        )
    with sessions() as session:
        resource, _ = resources.upload_resource(
            session,
            pid,
            DocumentResourceUpload(
                mime="image/png", content_base64=base64.b64encode(png()).decode()
            ),
        )
    with sessions() as session:
        receipt = materials.upload_material(
            session,
            pid,
            MaterialUpload.model_validate(
                {
                    "name": "自制规范",
                    "filename": "合成规范.txt",
                    "file_type": "text",
                    "kind": "requirements",
                    "source_note": "仅自制测试",
                    "content_base64": base64.b64encode(MATERIAL_TEXT.encode()).decode(),
                }
            ),
            f"seed-{uuid4()}",
        )
    assert execute_job(sessions, receipt.job.id, 60)
    with sessions() as session:
        task = tasks.create_task(
            session,
            pid,
            TaskCreate(
                command_id=uuid4(),
                expected_board_version=0,
                content=TaskContent.model_validate(
                    {
                        "title": "核对第一章",
                        "acceptance": "合成段落可定位并复核",
                        "evidence": [
                            {
                                "kind": "document",
                                "document_id": str(document.id),
                                "version": 1,
                                "selection": {
                                    "textblock_path": [1],
                                    "from": len(HEADING) + 3,
                                    "to": len(HEADING) + 5,
                                    "text": "采用",
                                },
                            }
                        ],
                    }
                ),
            ),
        )
    with sessions() as session:
        batch = feedback.create_feedback(
            session,
            pid,
            FeedbackCreate(command_id=uuid4(), original_text="第一章请补充方法甲的依据。"),
        )
    with sessions() as session:
        feedback.create_item(
            session,
            pid,
            batch.id,
            FeedbackItemCreate.model_validate(
                {
                    "command_id": str(uuid4()),
                    "content": {
                        "source_range": {"from": 0, "to": 3, "text": "第一章"},
                        "interpretation": "补充方法依据",
                        "certainty": "certain",
                        "source_checked": True,
                        "task_id": str(task.id),
                    },
                }
            ),
        )
    with sessions() as session:
        export = exports.create_document_export(
            session,
            pid,
            DocumentExportCreate(document_id=document.id, document_version=1, format="html"),
            f"seed-export-{uuid4()}",
        )
    assert execute_job(sessions, export.job_id, 60)
    with sessions() as session:
        plans.schedule(
            session,
            pid,
            PlanSchedule.model_validate(
                {
                    "command_id": str(uuid4()),
                    "changes": [
                        {
                            "task_id": str(task.id),
                            "expected_version": task.version,
                            "start_date": "2026-11-01",
                            "due_date": "2026-11-10",
                        }
                    ],
                    "reason": "按导师意见排期",
                }
            ),
        )
    with sessions() as session:
        parse_id = session.scalar(
            select(MaterialOriginal.latest_parse_id).where(
                MaterialOriginal.material_id == receipt.material.id
            )
        )
    with sessions() as session:
        materials.update_binding(
            session,
            pid,
            ProjectSourceBindingUpdate(
                expected_version=0,
                template_parse_version_id=None,
                requirement_parse_version_ids=[parse_id],
            ),
        )
    with sessions() as session:
        assistant.create_session(session, pid, AssistantSessionCreate(title="第一章修订"))
    with sessions() as session:
        literature.create_search(
            session, pid, LiteratureSearchCreate(command_id=uuid4(), query="synthetic method")
        )
    with sessions() as session:
        current = documents.get_current_document(session, pid)
        owner = session.get(Project, pid)
        assert owner is not None
    with sessions() as session:
        stages.confirm_stage(
            session,
            pid,
            StageConfirm.model_validate(
                {
                    "command_id": str(uuid4()),
                    "expected_project_version": owner.version,
                    "flow_version_id": str(flow.current_version_id),
                    "stage_id": "proposal",
                    "document_version": current.version,
                    "note": "本人已核对开题范围（自制）。",
                    "next_stage_id": "writing",
                }
            ),
        )
    with sessions() as session:
        notifications.refresh(session, pid)
    with sessions() as session:
        queued = jobs.create_job(
            session, JobCreate(project_id=pid, kind="diagnostic"), f"seed-{uuid4()}"
        )
    return Seeded(pid, document.id, task.id, receipt.material.id, queued.id, resource.sha256)
