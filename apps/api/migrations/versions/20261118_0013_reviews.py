"""reviews

Revision ID: 20261118_0013
Revises: 20261118_0012
"""

import sqlalchemy as sa
from alembic import op

revision = "20261118_0013"
down_revision = "20261118_0012"
branch_labels = None
depends_on = None

BASE_KINDS = (
    "'diagnostic', 'document_inspection', 'configuration_probe', "
    "'material_parse', 'content_revision'"
)
BASE_ARTIFACTS = (
    "'document_inspection', 'configuration_probe', 'material_parse', 'content_revision'"
)


def upgrade() -> None:
    op.create_table(
        "review_runs",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("project_id", sa.Uuid(), nullable=False),
        sa.Column("job_id", sa.Uuid(), nullable=True),
        sa.Column("source_review_id", sa.Uuid(), nullable=True),
        sa.Column("command_id", sa.Uuid(), nullable=False),
        sa.Column("request_hash", sa.String(length=64), nullable=False),
        sa.Column("document_id", sa.Uuid(), nullable=False),
        sa.Column("document_version", sa.BigInteger(), nullable=False),
        sa.Column("chapter_id", sa.String(length=200), nullable=True),
        sa.Column("rubric_version", sa.String(length=64), nullable=False),
        sa.Column("agent_config_version_id", sa.Uuid(), nullable=False),
        sa.Column("input_snapshot", sa.JSON(), nullable=False),
        sa.Column("context_snapshot", sa.JSON(), nullable=False),
        sa.Column("configuration_snapshot", sa.JSON(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint(
            "document_version >= 1", name=op.f("ck_review_runs_document_version_positive")
        ),
        sa.ForeignKeyConstraint(
            ["document_id", "document_version"],
            ["document_versions.document_id", "document_versions.version"],
            name="fk_review_runs_document_version",
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["job_id"], ["jobs.id"], name=op.f("fk_review_runs_job_id_jobs"), ondelete="RESTRICT"
        ),
        sa.ForeignKeyConstraint(
            ["project_id"],
            ["projects.id"],
            name=op.f("fk_review_runs_project_id_projects"),
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["source_review_id"],
            ["review_runs.id"],
            name=op.f("fk_review_runs_source_review_id_review_runs"),
            ondelete="RESTRICT",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_review_runs")),
        sa.UniqueConstraint("command_id", name=op.f("uq_review_runs_command_id")),
        sa.UniqueConstraint("job_id", name=op.f("uq_review_runs_job_id")),
    )
    op.create_index(op.f("ix_review_runs_project_id"), "review_runs", ["project_id"], unique=False)
    op.create_table(
        "review_reports",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("review_id", sa.Uuid(), nullable=False),
        sa.Column("project_id", sa.Uuid(), nullable=False),
        sa.Column("job_id", sa.Uuid(), nullable=False),
        sa.Column("requested_model", sa.String(length=200), nullable=False),
        sa.Column("response_model", sa.String(length=200), nullable=False),
        sa.Column("content", sa.JSON(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(
            ["job_id"], ["jobs.id"], name=op.f("fk_review_reports_job_id_jobs"), ondelete="RESTRICT"
        ),
        sa.ForeignKeyConstraint(
            ["project_id"],
            ["projects.id"],
            name=op.f("fk_review_reports_project_id_projects"),
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["review_id"],
            ["review_runs.id"],
            name=op.f("fk_review_reports_review_id_review_runs"),
            ondelete="RESTRICT",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_review_reports")),
        sa.UniqueConstraint("job_id", name=op.f("uq_review_reports_job_id")),
        sa.UniqueConstraint("review_id", name=op.f("uq_review_reports_review_id")),
    )
    op.create_index(
        op.f("ix_review_reports_project_id"), "review_reports", ["project_id"], unique=False
    )
    _job_kinds(True)
    op.execute("""
        CREATE FUNCTION tp_review_report_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN
            RAISE EXCEPTION 'Review reports are immutable' USING ERRCODE = '23514';
        END $$;
        CREATE TRIGGER review_reports_immutable BEFORE UPDATE OR DELETE ON review_reports
            FOR EACH ROW EXECUTE FUNCTION tp_review_report_immutable();
        CREATE FUNCTION tp_review_run_fixed() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN
            IF TG_OP = 'DELETE' THEN
                RAISE EXCEPTION 'Review runs cannot be deleted' USING ERRCODE = '23514';
            END IF;
            IF ROW(NEW.id, NEW.project_id, NEW.source_review_id, NEW.command_id,
                   NEW.request_hash, NEW.document_id, NEW.document_version, NEW.chapter_id,
                   NEW.rubric_version, NEW.agent_config_version_id, NEW.input_snapshot::text,
                   NEW.context_snapshot::text, NEW.configuration_snapshot::text, NEW.created_at)
               IS DISTINCT FROM
               ROW(OLD.id, OLD.project_id, OLD.source_review_id, OLD.command_id,
                   OLD.request_hash, OLD.document_id, OLD.document_version, OLD.chapter_id,
                   OLD.rubric_version, OLD.agent_config_version_id, OLD.input_snapshot::text,
                   OLD.context_snapshot::text, OLD.configuration_snapshot::text, OLD.created_at)
               OR (OLD.job_id IS NOT NULL AND NEW.job_id IS DISTINCT FROM OLD.job_id) THEN
                RAISE EXCEPTION 'Review run inputs are immutable' USING ERRCODE = '23514';
            END IF;
            RETURN NEW;
        END $$;
        CREATE TRIGGER review_runs_fixed BEFORE UPDATE OR DELETE ON review_runs
            FOR EACH ROW EXECUTE FUNCTION tp_review_run_fixed();
    """)


def downgrade() -> None:
    op.execute("""
        DO $$ BEGIN
            IF EXISTS (SELECT 1 FROM review_runs)
               OR EXISTS (SELECT 1 FROM jobs WHERE kind = 'review') THEN
                RAISE EXCEPTION '0012 cannot preserve review history';
            END IF;
        END $$;
    """)
    _job_kinds(False)
    op.drop_index(op.f("ix_review_reports_project_id"), table_name="review_reports")
    op.drop_table("review_reports")
    op.drop_index(op.f("ix_review_runs_project_id"), table_name="review_runs")
    op.drop_table("review_runs")
    op.execute("DROP FUNCTION tp_review_report_immutable(); DROP FUNCTION tp_review_run_fixed();")


def _job_kinds(include_review: bool) -> None:
    suffix = ", 'review'" if include_review else ""
    for table, name, kinds in (
        ("jobs", "ck_jobs_job_kind", BASE_KINDS),
        ("job_artifacts", "ck_job_artifacts_job_artifact_kind", BASE_ARTIFACTS),
    ):
        op.drop_constraint(op.f(name), table, type_="check")
        op.create_check_constraint(op.f(name), table, f"kind IN ({kinds}{suffix})")
