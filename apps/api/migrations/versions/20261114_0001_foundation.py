"""Initial project metadata, job state and transactional outbox.

Revision ID: 20261114_0001
Revises: None
"""

import sqlalchemy as sa
from alembic import op

revision = "20261114_0001"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "projects",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("name", sa.String(200), nullable=False),
        sa.Column("version", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint("version >= 1", name="version_positive"),
        sa.CheckConstraint("length(trim(name)) >= 1", name="name_nonempty"),
        sa.CheckConstraint("length(name) <= 200", name="name_length"),
        sa.PrimaryKeyConstraint("id", name="pk_projects"),
    )
    op.create_table(
        "jobs",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("project_id", sa.Uuid(), nullable=False),
        sa.Column("kind", sa.String(32), nullable=False),
        sa.Column("status", sa.String(16), nullable=False),
        sa.Column("idempotency_key", sa.String(128), nullable=False),
        sa.Column("request_hash", sa.String(64), nullable=False),
        sa.Column("attempt", sa.Integer(), nullable=False),
        sa.Column("run_token", sa.Uuid(), nullable=True),
        sa.Column("lease_until", sa.DateTime(timezone=True), nullable=True),
        sa.Column("result", sa.JSON(), nullable=True),
        sa.Column("error_code", sa.String(64), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint(
            "status IN ('queued', 'running', 'succeeded', 'failed', 'cancelled')", name="job_status"
        ),
        sa.CheckConstraint("kind = 'diagnostic'", name="job_kind"),
        sa.CheckConstraint("attempt >= 0", name="job_attempt_nonnegative"),
        sa.ForeignKeyConstraint(
            ["project_id"], ["projects.id"], name="fk_jobs_project_id_projects", ondelete="RESTRICT"
        ),
        sa.PrimaryKeyConstraint("id", name="pk_jobs"),
        sa.UniqueConstraint("idempotency_key", name="uq_jobs_idempotency_key"),
    )
    op.create_index("ix_jobs_project_id", "jobs", ["project_id"])
    op.create_index("ix_jobs_status_lease_until", "jobs", ["status", "lease_until"])
    op.create_table(
        "outbox_events",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("job_id", sa.Uuid(), nullable=False),
        sa.Column("attempts", sa.Integer(), nullable=False),
        sa.Column("next_attempt_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("published_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_error_code", sa.String(64), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint("attempts >= 0", name="outbox_attempts_nonnegative"),
        sa.ForeignKeyConstraint(
            ["job_id"], ["jobs.id"], name="fk_outbox_events_job_id_jobs", ondelete="RESTRICT"
        ),
        sa.PrimaryKeyConstraint("id", name="pk_outbox_events"),
        sa.UniqueConstraint("job_id", name="uq_outbox_events_job_id"),
    )
    op.create_index("ix_outbox_due", "outbox_events", ["next_attempt_at", "published_at"])


def downgrade() -> None:
    # Operator-controlled migration only. Runtime never downgrades or drops tables.
    op.drop_index("ix_outbox_due", table_name="outbox_events")
    op.drop_table("outbox_events")
    op.drop_index("ix_jobs_status_lease_until", table_name="jobs")
    op.drop_index("ix_jobs_project_id", table_name="jobs")
    op.drop_table("jobs")
    op.drop_table("projects")
