"""Real PostgreSQL plan-adjustment boundaries; model replies are explicit TEST STUBS.

No test here calls a provider or proves a real model invocation. Stubs exercise frozen inputs,
row-locked concurrent adoption, immutable history, late replies and migration safety.
"""

from concurrent.futures import ThreadPoolExecutor
from datetime import timedelta
from threading import Barrier
from uuid import UUID, uuid4

import pytest
from alembic import command
from alembic.script import ScriptDirectory
from sqlalchemy import func, select, text
from sqlalchemy.exc import DBAPIError

from thesis_pilot.core.errors import AppError
from thesis_pilot.modules.ai_configs.schemas import (
    AgentConfigContent,
    APIConfigContent,
    ModelConfigContent,
    PromptConfigContent,
)
from thesis_pilot.modules.jobs.models import JobArtifact
from thesis_pilot.modules.jobs.service import claim_job
from thesis_pilot.modules.notifications.derivation import local_today
from thesis_pilot.modules.notifications.models import utcnow
from thesis_pilot.modules.plans import service as plans
from thesis_pilot.modules.plans.jobs import finish_plan_job, load_plan_snapshot
from thesis_pilot.modules.plans.models import PlanProposal, PlanVersion
from thesis_pilot.modules.plans.schemas import (
    PlanAdjustmentCreate,
    PlanAdjustmentDecide,
    PlanCompletion,
    PlanModelReply,
)
from thesis_pilot.modules.projects.schemas import ProjectCreate
from thesis_pilot.modules.projects.service import create_project
from thesis_pilot.modules.tasks import service as tasks
from thesis_pilot.modules.tasks.models import ProjectTask
from thesis_pilot.modules.tasks.schemas import TaskCreate

from .conftest import PostgreSQLSandbox
from .test_ai_configs import config

pytestmark = pytest.mark.integration
STUB_MODEL = "teststub-no-provider-call"
TODAY = local_today(utcnow())


def day(offset: int) -> str:
    return (TODAY + timedelta(days=offset)).isoformat()


def prepare(postgres: PostgreSQLSandbox) -> tuple[UUID, UUID, list[UUID]]:
    with postgres.sessions() as session:
        project_id = create_project(
            session, ProjectCreate(name="合成计划集成", deadline=TODAY + timedelta(days=60))
        ).id
    ids: list[UUID] = []
    for index, (title, start, due) in enumerate(
        (("文献综述", 1, 5), ("实验方法", 6, 12), ("初稿", 13, 25))
    ):
        with postgres.sessions() as session:
            board = tasks.list_tasks(session, project_id, limit=1, offset=0).board_version
            content = {
                "title": title,
                "acceptance": "形成可核对的产物。",
                "start_date": day(start),
                "due_date": day(due),
                "depends_on": [str(ids[-1])] if index else [],
            }
            ids.append(
                tasks.create_task(
                    session,
                    project_id,
                    TaskCreate.model_validate(
                        {
                            "command_id": str(uuid4()),
                            "expected_board_version": board,
                            "content": content,
                        }
                    ),
                ).id
            )
    api = config(postgres, APIConfigContent(kind="api", max_retries=1))
    model = config(
        postgres,
        ModelConfigContent(
            kind="model",
            api_version_id=api.current_version_id,
            model_code="deepseek-flash",
            capabilities=["plan"],
        ),
    )
    prompt = config(
        postgres,
        PromptConfigContent(kind="prompt", template="计划：{{context}}", variables=["context"]),
    )
    agent = config(
        postgres,
        AgentConfigContent(
            kind="agent",
            role="progress",
            instructions="只提出计划建议。",
            model_version_id=model.current_version_id,
            prompt_version_id=prompt.current_version_id,
        ),
    )
    return project_id, agent.current_version_id, ids


def completion(*changes: tuple[str, str, str]) -> PlanCompletion:
    return PlanCompletion(
        reply=PlanModelReply.model_validate(
            {
                "summary": "TEST STUB 计划摘要",
                "changes": [
                    {"task": key, "start_date": start, "due_date": due, "reason": "合成理由"}
                    for key, start, due in changes
                ],
            }
        ),
        requested_model="deepseek-flash",
        response_model=STUB_MODEL,
    )


def candidate(postgres: PostgreSQLSandbox, project_id: UUID, agent_id: UUID, done: PlanCompletion):
    with postgres.sessions() as session:
        receipt = plans.create_adjustment(
            session,
            project_id,
            PlanAdjustmentCreate(command_id=uuid4(), agent_config_version_id=agent_id),
        )
    claim = claim_job(postgres.sessions, receipt.job.id, 60)
    assert claim is not None and load_plan_snapshot(postgres.sessions, claim) is not None
    assert finish_plan_job(postgres.sessions, claim, done)
    return receipt.adjustment.id


def adopt(postgres: PostgreSQLSandbox, project_id: UUID, adjustment_id: UUID) -> str:
    with postgres.sessions() as session:
        try:
            plans.decide(
                session,
                project_id,
                adjustment_id,
                PlanAdjustmentDecide(command_id=uuid4(), action="adopt", accepted_item_ids=["A1"]),
            )
            return "adopted"
        except AppError as error:
            return error.code


def test_concurrent_adoptions_write_exactly_one_plan(postgres: PostgreSQLSandbox) -> None:
    project_id, agent_id, ids = prepare(postgres)
    first = candidate(postgres, project_id, agent_id, completion(("T3", day(14), day(28))))
    second = candidate(postgres, project_id, agent_id, completion(("T3", day(15), day(29))))
    barrier = Barrier(2)

    def run(adjustment_id: UUID) -> str:
        barrier.wait()
        return adopt(postgres, project_id, adjustment_id)

    with ThreadPoolExecutor(2) as pool:
        results = sorted(pool.map(run, (first, second)))
    assert results == ["PLAN_CANDIDATE_STALE", "adopted"]
    with postgres.sessions() as session:
        assert session.scalar(select(func.count()).select_from(PlanVersion)) == 1
        row = session.get(ProjectTask, ids[2])
        assert row is not None and row.version == 2
        assert row.content["due_date"] in {day(28), day(29)}


def test_same_candidate_double_submit_decides_once(postgres: PostgreSQLSandbox) -> None:
    project_id, agent_id, _ = prepare(postgres)
    adjustment_id = candidate(postgres, project_id, agent_id, completion(("T3", day(14), day(28))))
    barrier = Barrier(2)

    def run(_: int) -> str:
        barrier.wait()
        return adopt(postgres, project_id, adjustment_id)

    with ThreadPoolExecutor(2) as pool:
        results = sorted(pool.map(run, range(2)))
    assert results[1] == "adopted"
    assert results[0] in {"PLAN_ALREADY_DECIDED", "PLAN_CANDIDATE_STALE"}
    with postgres.sessions() as session:
        assert session.scalar(select(func.count()).select_from(PlanVersion)) == 1


def test_history_is_immutable_and_late_reply_is_dropped(postgres: PostgreSQLSandbox) -> None:
    project_id, agent_id, _ = prepare(postgres)
    adjustment_id = candidate(postgres, project_id, agent_id, completion(("T3", day(14), day(28))))
    assert adopt(postgres, project_id, adjustment_id) == "adopted"
    for statement in (
        "UPDATE plan_versions SET reason = 'x'",
        "DELETE FROM plan_versions",
        "UPDATE plan_proposals SET content = '{}'",
        "DELETE FROM plan_decisions",
        "UPDATE plan_adjustments SET input_snapshot = '{}'",
        "DELETE FROM plan_adjustments",
    ):
        with postgres.sessions() as session, pytest.raises(DBAPIError):
            session.execute(text(statement))
            session.flush()

    with postgres.sessions() as session:
        receipt = plans.create_adjustment(
            session,
            project_id,
            PlanAdjustmentCreate(command_id=uuid4(), agent_config_version_id=agent_id),
        )
    claim = claim_job(postgres.sessions, receipt.job.id, 60)
    assert claim is not None
    with postgres.sessions() as session:
        assert plans.cancel_adjustment(session, project_id, receipt.adjustment.id).state == (
            "cancelled"
        )
    assert finish_plan_job(postgres.sessions, claim, completion(("T2", day(7), day(12)))) is False
    with postgres.sessions() as session:
        assert session.scalar(select(func.count()).select_from(PlanProposal)) == 1
        assert session.scalar(select(func.count()).select_from(JobArtifact)) == 1


def test_plan_migration_downgrades_only_without_plan_history(postgres: PostgreSQLSandbox) -> None:
    engine = postgres.sessions.kw["bind"]
    try:
        with engine.begin() as connection:
            postgres.alembic.attributes["connection"] = connection
            command.downgrade(postgres.alembic, "20261118_0016")
            command.upgrade(postgres.alembic, "head")
    finally:
        postgres.alembic.attributes.pop("connection", None)
    project_id, agent_id, _ = prepare(postgres)
    candidate(postgres, project_id, agent_id, completion(("T3", day(14), day(28))))
    try:
        with pytest.raises(DBAPIError), engine.begin() as connection:
            postgres.alembic.attributes["connection"] = connection
            command.downgrade(postgres.alembic, "20261118_0016")
    finally:
        postgres.alembic.attributes.pop("connection", None)
    with postgres.sessions() as session:
        head = ScriptDirectory.from_config(postgres.alembic).get_current_head()
        assert session.scalar(text("SELECT version_num FROM alembic_version")) == head
