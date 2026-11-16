"""Real PostgreSQL feedback decomposition boundaries; model replies are explicit TEST STUBS.

No test here calls a provider or proves a real model invocation. Stubs exercise fixed inputs,
atomic suggestion persistence, immutability, CAS decisions and late-reply handling.
"""

from concurrent.futures import ThreadPoolExecutor
from threading import Barrier
from uuid import UUID, uuid4

import pytest
from alembic import command
from sqlalchemy import create_engine, func, select, text
from sqlalchemy.exc import DBAPIError
from sqlalchemy.orm import sessionmaker

from thesis_pilot.core.errors import AppError
from thesis_pilot.modules.ai_configs.schemas import (
    AgentConfigContent,
    APIConfigContent,
    ModelConfigContent,
    PromptConfigContent,
)
from thesis_pilot.modules.feedback import service as feedback
from thesis_pilot.modules.feedback.models import FeedbackItem
from thesis_pilot.modules.feedback.schemas import FeedbackCreate
from thesis_pilot.modules.feedback_splits import service as splits
from thesis_pilot.modules.feedback_splits.jobs import finish_split, load_split_snapshot
from thesis_pilot.modules.feedback_splits.models import FeedbackSplitSuggestion
from thesis_pilot.modules.feedback_splits.schemas import (
    FeedbackSplitCreate,
    FeedbackSplitDecide,
    SplitCompletion,
    SplitModelReply,
)
from thesis_pilot.modules.jobs.models import Job, JobArtifact
from thesis_pilot.modules.jobs.service import claim_job

from .conftest import PostgreSQLSandbox
from .test_ai_configs import config
from .test_services import make_project

pytestmark = pytest.mark.integration
STUB_MODEL = "teststub-no-provider-call"
FIRST = "第一章缺少研究问题的界定。"
SECOND = "图2 的数据来源没有标注。"
ORIGINAL = f"{FIRST}\n{SECOND}"


def prepare(postgres: PostgreSQLSandbox) -> tuple[UUID, UUID, UUID]:
    project_id = make_project(postgres)
    with postgres.sessions() as session:
        batch = feedback.create_feedback(
            session,
            project_id,
            FeedbackCreate(command_id=uuid4(), expected_version=0, original_text=ORIGINAL),
        )
    api = config(postgres, APIConfigContent(kind="api", max_retries=1))
    model = config(
        postgres,
        ModelConfigContent(
            kind="model",
            api_version_id=api.current_version_id,
            model_code="deepseek-flash",
            capabilities=["text"],
        ),
    )
    prompt = config(
        postgres,
        PromptConfigContent(kind="prompt", template="拆解：{{context}}", variables=["context"]),
    )
    agent = config(
        postgres,
        AgentConfigContent(
            kind="agent",
            role="content",
            instructions="只拆解。",
            model_version_id=model.current_version_id,
            prompt_version_id=prompt.current_version_id,
        ),
    )
    return project_id, batch.id, agent.current_version_id


def completion() -> SplitCompletion:
    start = len(FIRST) + 1
    return SplitCompletion(
        reply=SplitModelReply.model_validate(
            {
                "items": [
                    {
                        "from": 0,
                        "to": len(FIRST),
                        "text": FIRST,
                        "interpretation": "TEST STUB 界定研究问题",
                        "certainty": "certain",
                        "ambiguous": False,
                        "task_title": "界定研究问题",
                    },
                    {
                        "from": start,
                        "to": start + len(SECOND),
                        "text": SECOND,
                        "interpretation": "TEST STUB 标注数据来源",
                        "certainty": "uncertain",
                        "ambiguous": True,
                        "task_title": None,
                    },
                ],
                "note": "",
            }
        ),
        requested_model="deepseek-flash",
        response_model=STUB_MODEL,
    )


def started(postgres: PostgreSQLSandbox) -> tuple[UUID, UUID, UUID]:
    project_id, batch_id, agent_id = prepare(postgres)
    with postgres.sessions() as session:
        receipt = splits.create_split(
            session,
            project_id,
            batch_id,
            FeedbackSplitCreate(command_id=uuid4(), agent_config_version_id=agent_id),
        )
    return project_id, receipt.split.id, receipt.job.id


def test_suggestions_are_atomic_immutable_and_survive_restart(
    postgres: PostgreSQLSandbox,
) -> None:
    project_id, split_id, job_id = started(postgres)
    claim = claim_job(postgres.sessions, job_id, 60)
    assert claim is not None and load_split_snapshot(postgres.sessions, claim) is not None
    assert finish_split(postgres.sessions, claim, completion())
    engine = create_engine(postgres.url, hide_parameters=True)
    try:
        restarted = sessionmaker(bind=engine, expire_on_commit=False, autoflush=False)
        with restarted() as session:
            view = splits.get_split(session, project_id, split_id)
        assert view.status == "succeeded" and len(view.suggestions) == 2
        assert view.suggestions[1].ambiguous and view.suggestions[1].certainty == "uncertain"
        with restarted() as session:
            assert session.scalar(select(func.count()).select_from(FeedbackItem)) == 0
    finally:
        engine.dispose()
    for statement in (
        "UPDATE feedback_split_suggestions SET interpretation = 'x'",
        "DELETE FROM feedback_split_suggestions",
        "UPDATE feedback_split_runs SET context_snapshot = '{}'",
        "DELETE FROM feedback_split_runs",
    ):
        with postgres.sessions() as session, pytest.raises(DBAPIError):
            session.execute(text(statement))
            session.flush()


def test_late_reply_after_cancel_stores_nothing(postgres: PostgreSQLSandbox) -> None:
    project_id, split_id, job_id = started(postgres)
    claim = claim_job(postgres.sessions, job_id, 60)
    assert claim is not None
    with postgres.sessions() as session:
        assert splits.cancel_split(session, project_id, split_id).status == "cancelled"
    assert finish_split(postgres.sessions, claim, completion()) is False
    with postgres.sessions() as session:
        assert session.scalar(select(func.count()).select_from(FeedbackSplitSuggestion)) == 0
        assert session.scalar(select(func.count()).select_from(JobArtifact)) == 0
        job = session.get(Job, job_id)
        assert job is not None and job.status == "cancelled"


def test_concurrent_double_adopt_creates_one_item_and_decisions_are_append_only(
    postgres: PostgreSQLSandbox,
) -> None:
    project_id, split_id, job_id = started(postgres)
    claim = claim_job(postgres.sessions, job_id, 60)
    assert claim is not None and finish_split(postgres.sessions, claim, completion())
    with postgres.sessions() as session:
        target = splits.get_split(session, project_id, split_id).suggestions[0].id
    barrier = Barrier(2)

    def adopt(_: int) -> str:
        barrier.wait()
        with postgres.sessions() as session:
            try:
                splits.decide(
                    session,
                    project_id,
                    split_id,
                    FeedbackSplitDecide.model_validate(
                        {
                            "command_id": str(uuid4()),
                            "decisions": [
                                {
                                    "suggestion_id": str(target),
                                    "expected_version": 0,
                                    "action": "adopt",
                                }
                            ],
                        }
                    ),
                )
                return "adopted"
            except AppError as error:
                return error.code

    with ThreadPoolExecutor(2) as pool:
        results = sorted(pool.map(adopt, range(2)))
    assert results == ["FEEDBACK_SPLIT_VERSION_CONFLICT", "adopted"]
    with postgres.sessions() as session:
        rows = session.scalars(select(FeedbackItem)).all()
        assert len(rows) == 1 and rows[0].origin == "ai_suggested"
    with postgres.sessions() as session, pytest.raises(DBAPIError):
        session.execute(text("UPDATE feedback_split_decisions SET action = 'reject'"))
        session.flush()


def test_concurrent_creates_allow_one_active_split(postgres: PostgreSQLSandbox) -> None:
    project_id, batch_id, agent_id = prepare(postgres)
    barrier = Barrier(2)

    def submit(_: int) -> str:
        barrier.wait()
        with postgres.sessions() as session:
            try:
                splits.create_split(
                    session,
                    project_id,
                    batch_id,
                    FeedbackSplitCreate(command_id=uuid4(), agent_config_version_id=agent_id),
                )
                return "created"
            except AppError as error:
                return error.code

    with ThreadPoolExecutor(2) as pool:
        results = sorted(pool.map(submit, range(2)))
    assert results == ["FEEDBACK_SPLIT_BUSY", "created"]


def test_migration_downgrades_only_without_split_history(postgres: PostgreSQLSandbox) -> None:
    engine = postgres.sessions.kw["bind"]
    try:
        with engine.begin() as connection:
            postgres.alembic.attributes["connection"] = connection
            command.downgrade(postgres.alembic, "20261118_0016")
            command.upgrade(postgres.alembic, "head")
    finally:
        postgres.alembic.attributes.pop("connection", None)
    started(postgres)
    try:
        with pytest.raises(DBAPIError), engine.begin() as connection:
            postgres.alembic.attributes["connection"] = connection
            command.downgrade(postgres.alembic, "20261118_0016")
    finally:
        postgres.alembic.attributes.pop("connection", None)
    with postgres.sessions() as session:
        # The refused downgrade rolls back as one transaction, so the schema stays at head.
        assert session.scalar(text("SELECT version_num FROM alembic_version")) == "20261118_0017"
