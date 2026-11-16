"""Stage confirmation CAS, idempotency and append-only revocation on real PostgreSQL."""

from concurrent.futures import ThreadPoolExecutor
from threading import Barrier
from uuid import UUID, uuid4

import pytest
from sqlalchemy import func, select

from thesis_pilot.core.errors import AppError
from thesis_pilot.modules.documents import service as documents
from thesis_pilot.modules.documents.schemas import DocumentImport
from thesis_pilot.modules.project_flows import service as flows
from thesis_pilot.modules.project_flows.schemas import FlowCreate
from thesis_pilot.modules.projects import service as projects
from thesis_pilot.modules.projects.schemas import ProjectCreate, ProjectRead, ProjectUpdate
from thesis_pilot.modules.stage_confirmations import service
from thesis_pilot.modules.stage_confirmations.models import StageConfirmation
from thesis_pilot.modules.stage_confirmations.schemas import StageConfirm, StageRevoke

from .conftest import PostgreSQLSandbox

pytestmark = pytest.mark.integration


def seed(postgres: PostgreSQLSandbox) -> ProjectRead:
    stages = [
        {
            "id": "proposal",
            "name": "开题",
            "deliverables": ["自制开题报告"],
            "conditions": ["学生核对"],
            "dependencies": [],
        },
        {
            "id": "writing",
            "name": "写作",
            "deliverables": ["自制初稿"],
            "conditions": ["学生核对"],
            "dependencies": ["proposal"],
        },
    ]
    with postgres.sessions() as session:
        flow = flows.create_flow(session, FlowCreate(name="自制流程", stages=stages))
    with postgres.sessions() as session:
        owner = projects.create_project(
            session,
            ProjectCreate(
                name="自制项目", flow_version_id=flow.current_version_id, stage_id="proposal"
            ),
        )
    content = {
        "schema_version": 1,
        "json": {
            "type": "doc",
            "content": [{"type": "paragraph", "content": [{"type": "text", "text": "合成"}]}],
        },
    }
    with postgres.sessions() as session:
        documents.import_document(
            session, owner.id, DocumentImport.model_validate({"content": content})
        )
    return owner


def request(owner: ProjectRead, note: str = "已核对自制开题报告") -> StageConfirm:
    return StageConfirm.model_validate(
        {
            "command_id": uuid4(),
            "expected_project_version": owner.version,
            "flow_version_id": owner.flow_version_id,
            "stage_id": "proposal",
            "document_version": 1,
            "note": note,
            "next_stage_id": "writing",
        }
    )


def attempt(postgres: PostgreSQLSandbox, barrier: Barrier, call):  # type: ignore[no-untyped-def]
    barrier.wait()
    with postgres.sessions() as session:
        try:
            return call(session)
        except AppError as error:
            return error.code


def records(postgres: PostgreSQLSandbox, project_id: UUID) -> int:
    with postgres.sessions() as session:
        return (
            session.scalar(
                select(func.count())
                .select_from(StageConfirmation)
                .where(StageConfirmation.project_id == project_id)
            )
            or 0
        )


def test_concurrent_different_commands_allow_exactly_one_confirmation(
    postgres: PostgreSQLSandbox,
) -> None:
    owner = seed(postgres)
    barrier = Barrier(2, timeout=10)
    calls = [request(owner, "窗口一"), request(owner, "窗口二")]
    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(
            pool.map(
                lambda data: attempt(
                    postgres, barrier, lambda s: service.confirm_stage(s, owner.id, data)
                ),
                calls,
            )
        )
    codes = sorted(item if isinstance(item, str) else "ok" for item in results)
    assert codes == ["STAGE_VERSION_CONFLICT", "ok"]
    assert records(postgres, owner.id) == 1
    with postgres.sessions() as session:
        current = projects.get_project(session, owner.id)
    assert (current.stage_id, current.version) == ("writing", owner.version + 1)


def test_same_command_concurrently_replays_one_record(postgres: PostgreSQLSandbox) -> None:
    owner = seed(postgres)
    data = request(owner)
    barrier = Barrier(2, timeout=10)
    with ThreadPoolExecutor(max_workers=2) as pool:
        first, second = pool.map(
            lambda _: attempt(
                postgres, barrier, lambda s: service.confirm_stage(s, owner.id, data)
            ),
            range(2),
        )
    assert first == second
    assert not isinstance(first, str)
    assert records(postgres, owner.id) == 1


def test_confirmation_races_project_settings_without_lost_update(
    postgres: PostgreSQLSandbox,
) -> None:
    owner = seed(postgres)
    barrier = Barrier(2, timeout=10)
    with ThreadPoolExecutor(max_workers=2) as pool:
        confirm = pool.submit(
            attempt,
            postgres,
            barrier,
            lambda s: service.confirm_stage(s, owner.id, request(owner)),
        )
        rename = pool.submit(
            attempt,
            postgres,
            barrier,
            lambda s: projects.update_project(
                s, owner.id, ProjectUpdate(expected_version=owner.version, name="改名")
            ),
        )
        outcomes = [confirm.result(timeout=10), rename.result(timeout=10)]
    assert sum(isinstance(item, str) for item in outcomes) == 1
    assert set(item for item in outcomes if isinstance(item, str)) <= {
        "STAGE_VERSION_CONFLICT",
        "PROJECT_VERSION_CONFLICT",
    }
    with postgres.sessions() as session:
        current = projects.get_project(session, owner.id)
    assert current.version == owner.version + 1
    assert records(postgres, owner.id) == (0 if isinstance(outcomes[0], str) else 1)


def test_concurrent_revocations_append_one_revoke(postgres: PostgreSQLSandbox) -> None:
    owner = seed(postgres)
    with postgres.sessions() as session:
        confirmed = service.confirm_stage(session, owner.id, request(owner))
    version = confirmed.project.version
    barrier = Barrier(2, timeout=10)

    def revoke(_: int):  # type: ignore[no-untyped-def]
        data = StageRevoke(command_id=uuid4(), expected_project_version=version)
        return attempt(
            postgres,
            barrier,
            lambda s: service.revoke_stage(s, owner.id, confirmed.confirmation.id, data),
        )

    with ThreadPoolExecutor(max_workers=2) as pool:
        outcomes = list(pool.map(revoke, range(2)))
    assert sorted(item if isinstance(item, str) else "ok" for item in outcomes) == [
        "STAGE_VERSION_CONFLICT",
        "ok",
    ]
    assert records(postgres, owner.id) == 2
    with postgres.sessions() as session:
        history = service.list_confirmations(session, owner.id, limit=10, offset=0)
        assert projects.get_project(session, owner.id).stage_id == "proposal"
    assert [item.kind for item in history.items] == ["revoke", "confirm"]
    assert history.items[1].revoked_by_id == history.items[0].id
