"""固定业务任务输入、执行尝试与产物。"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20261117_0006"
down_revision: str | None = "20261117_0005"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    job_kind = op.f("ck_jobs_job_kind")
    op.drop_constraint(job_kind, "jobs", type_="check")
    op.create_check_constraint(job_kind, "jobs", "kind IN ('diagnostic', 'document_inspection')")
    op.add_column("jobs", sa.Column("input_snapshot", sa.JSON(), nullable=True))
    op.add_column("jobs", sa.Column("configuration", sa.JSON(), nullable=True))
    op.add_column("jobs", sa.Column("resource_scope", sa.JSON(), nullable=True))
    op.add_column("jobs", sa.Column("source_job_id", sa.Uuid(), nullable=True))
    op.create_foreign_key(
        "fk_jobs_source_job_id_jobs", "jobs", "jobs", ["source_job_id"], ["id"], ondelete="RESTRICT"
    )
    op.create_table(
        "job_attempts",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("job_id", sa.Uuid(), nullable=False),
        sa.Column("attempt", sa.Integer(), nullable=False),
        sa.Column("run_token", sa.Uuid(), nullable=False),
        sa.Column("status", sa.String(16), nullable=False),
        sa.Column("error_code", sa.String(64), nullable=True),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("finished_at", sa.DateTime(timezone=True), nullable=True),
        sa.PrimaryKeyConstraint("id", name="pk_job_attempts"),
        sa.ForeignKeyConstraint(
            ["job_id"], ["jobs.id"], name="fk_job_attempts_job_id_jobs", ondelete="RESTRICT"
        ),
        sa.UniqueConstraint("job_id", "attempt", name="uq_job_attempts_job_attempt"),
        sa.UniqueConstraint("run_token", name="uq_job_attempts_run_token"),
        sa.CheckConstraint("attempt >= 1", name=op.f("ck_job_attempts_job_attempt_positive")),
        sa.CheckConstraint(
            "status IN ('running', 'succeeded', 'failed', 'cancelled', 'lease_expired')",
            name=op.f("ck_job_attempts_job_attempt_status"),
        ),
    )
    op.create_table(
        "job_artifacts",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("job_id", sa.Uuid(), nullable=False),
        sa.Column("attempt_id", sa.Uuid(), nullable=False),
        sa.Column("kind", sa.String(32), nullable=False),
        sa.Column("schema_version", sa.Integer(), nullable=False),
        sa.Column("result", sa.JSON(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("id", name="pk_job_artifacts"),
        sa.ForeignKeyConstraint(
            ["job_id"], ["jobs.id"], name="fk_job_artifacts_job_id_jobs", ondelete="RESTRICT"
        ),
        sa.ForeignKeyConstraint(
            ["attempt_id"],
            ["job_attempts.id"],
            name="fk_job_artifacts_attempt_id_job_attempts",
            ondelete="RESTRICT",
        ),
        sa.UniqueConstraint("job_id", name="uq_job_artifacts_job_id"),
        sa.UniqueConstraint("attempt_id", name="uq_job_artifacts_attempt_id"),
        sa.CheckConstraint(
            "kind = 'document_inspection'", name=op.f("ck_job_artifacts_job_artifact_kind")
        ),
        sa.CheckConstraint(
            "schema_version = 1", name=op.f("ck_job_artifacts_job_artifact_schema_version")
        ),
    )


def downgrade() -> None:
    op.execute(
        """
        DO $$
        BEGIN
            IF EXISTS (SELECT 1 FROM jobs WHERE kind <> 'diagnostic' OR source_job_id IS NOT NULL)
                OR EXISTS (SELECT 1 FROM job_attempts) THEN
                RAISE EXCEPTION '0005 cannot preserve business jobs or recorded attempts';
            END IF;
        END
        $$
        """
    )
    op.drop_table("job_artifacts")
    op.drop_table("job_attempts")
    op.drop_constraint("fk_jobs_source_job_id_jobs", "jobs", type_="foreignkey")
    op.drop_column("jobs", "source_job_id")
    op.drop_column("jobs", "resource_scope")
    op.drop_column("jobs", "configuration")
    op.drop_column("jobs", "input_snapshot")
    job_kind = op.f("ck_jobs_job_kind")
    op.drop_constraint(job_kind, "jobs", type_="check")
    op.create_check_constraint(job_kind, "jobs", "kind = 'diagnostic'")
