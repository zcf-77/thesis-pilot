"""feedback_splits

Revision ID: 20261118_0017
Revises: 20261118_0016
"""

import sqlalchemy as sa
from alembic import op

revision = "20261118_0017"
down_revision = "20261118_0016"
branch_labels = None
depends_on = None

# Kinds already allowed at 20261118_0016 (see jobs/models.py); feedback_decomposition is added.
BASE_KINDS = (
    "'diagnostic', 'document_inspection', 'configuration_probe', "
    "'material_parse', 'content_revision', 'document_export', 'change_record', 'review'"
)
BASE_ARTIFACTS = (
    "'document_inspection', 'configuration_probe', 'material_parse', 'content_revision', "
    "'document_export', 'change_record', 'review'"
)


def upgrade() -> None:
    op.add_column(
        "feedback_items",
        sa.Column("origin", sa.String(length=16), server_default="manual", nullable=False),
    )
    op.create_check_constraint(
        op.f("ck_feedback_items_origin_supported"),
        "feedback_items",
        "origin IN ('manual','ai_suggested')",
    )
    _item_status(True)
    op.create_table(
        "feedback_split_runs",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("project_id", sa.Uuid(), nullable=False),
        sa.Column("batch_id", sa.Uuid(), nullable=False),
        sa.Column("job_id", sa.Uuid(), nullable=True),
        sa.Column("source_split_id", sa.Uuid(), nullable=True),
        sa.Column("command_id", sa.Uuid(), nullable=False),
        sa.Column("request_hash", sa.String(length=64), nullable=False),
        sa.Column("original_sha256", sa.String(length=64), nullable=False),
        sa.Column("agent_config_version_id", sa.Uuid(), nullable=False),
        sa.Column("context_snapshot", sa.JSON(), nullable=False),
        sa.Column("configuration_snapshot", sa.JSON(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(
            ["batch_id"],
            ["feedback_batches.id"],
            name=op.f("fk_feedback_split_runs_batch_id_feedback_batches"),
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["job_id"],
            ["jobs.id"],
            name=op.f("fk_feedback_split_runs_job_id_jobs"),
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["project_id"],
            ["projects.id"],
            name=op.f("fk_feedback_split_runs_project_id_projects"),
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["source_split_id"],
            ["feedback_split_runs.id"],
            name=op.f("fk_feedback_split_runs_source_split_id_feedback_split_runs"),
            ondelete="RESTRICT",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_feedback_split_runs")),
        sa.UniqueConstraint("command_id", name=op.f("uq_feedback_split_runs_command_id")),
        sa.UniqueConstraint("job_id", name=op.f("uq_feedback_split_runs_job_id")),
    )
    op.create_index(
        op.f("ix_feedback_split_runs_batch_id"), "feedback_split_runs", ["batch_id"], unique=False
    )
    op.create_index(
        op.f("ix_feedback_split_runs_project_id"),
        "feedback_split_runs",
        ["project_id"],
        unique=False,
    )
    op.create_table(
        "feedback_split_suggestions",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("split_id", sa.Uuid(), nullable=False),
        sa.Column("project_id", sa.Uuid(), nullable=False),
        sa.Column("batch_id", sa.Uuid(), nullable=False),
        sa.Column("job_id", sa.Uuid(), nullable=False),
        sa.Column("position", sa.Integer(), nullable=False),
        sa.Column("range_from", sa.Integer(), nullable=False),
        sa.Column("range_to", sa.Integer(), nullable=False),
        sa.Column("range_text", sa.Text(), nullable=False),
        sa.Column("interpretation", sa.Text(), nullable=False),
        sa.Column("certainty", sa.String(length=16), nullable=False),
        sa.Column("ambiguous", sa.Boolean(), nullable=False),
        sa.Column("task_title", sa.String(length=200), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint(
            "certainty IN ('certain','uncertain')",
            name=op.f("ck_feedback_split_suggestions_certainty_supported"),
        ),
        sa.CheckConstraint(
            "range_from >= 0 AND range_to > range_from",
            name=op.f("ck_feedback_split_suggestions_range_ordered"),
        ),
        sa.ForeignKeyConstraint(
            ["batch_id"],
            ["feedback_batches.id"],
            name=op.f("fk_feedback_split_suggestions_batch_id_feedback_batches"),
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["job_id"],
            ["jobs.id"],
            name=op.f("fk_feedback_split_suggestions_job_id_jobs"),
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["project_id"],
            ["projects.id"],
            name=op.f("fk_feedback_split_suggestions_project_id_projects"),
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["split_id"],
            ["feedback_split_runs.id"],
            name=op.f("fk_feedback_split_suggestions_split_id_feedback_split_runs"),
            ondelete="RESTRICT",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_feedback_split_suggestions")),
    )
    op.create_index(
        op.f("ix_feedback_split_suggestions_project_id"),
        "feedback_split_suggestions",
        ["project_id"],
        unique=False,
    )
    op.create_index(
        op.f("ix_feedback_split_suggestions_split_id"),
        "feedback_split_suggestions",
        ["split_id"],
        unique=False,
    )
    op.create_table(
        "feedback_split_decisions",
        sa.Column("suggestion_id", sa.Uuid(), nullable=False),
        sa.Column("version", sa.Integer(), nullable=False),
        sa.Column("project_id", sa.Uuid(), nullable=False),
        sa.Column("action", sa.String(length=16), nullable=False),
        sa.Column("feedback_item_id", sa.Uuid(), nullable=True),
        sa.Column("reason", sa.String(length=2000), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint(
            "action IN ('adopt','adopt_modified','reject','undo')",
            name=op.f("ck_feedback_split_decisions_action_supported"),
        ),
        sa.CheckConstraint(
            "version >= 1", name=op.f("ck_feedback_split_decisions_version_positive")
        ),
        sa.ForeignKeyConstraint(
            ["feedback_item_id"],
            ["feedback_items.id"],
            name=op.f("fk_feedback_split_decisions_feedback_item_id_feedback_items"),
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["project_id"],
            ["projects.id"],
            name=op.f("fk_feedback_split_decisions_project_id_projects"),
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["suggestion_id"],
            ["feedback_split_suggestions.id"],
            name=op.f("fk_feedback_split_decisions_suggestion_id_feedback_split_suggestions"),
            ondelete="RESTRICT",
        ),
        sa.PrimaryKeyConstraint(
            "suggestion_id", "version", name=op.f("pk_feedback_split_decisions")
        ),
    )
    op.create_index(
        op.f("ix_feedback_split_decisions_project_id"),
        "feedback_split_decisions",
        ["project_id"],
        unique=False,
    )
    _job_kinds(True)
    op.execute("""
        CREATE FUNCTION tp_feedback_split_fact_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN
            RAISE EXCEPTION 'Feedback split suggestions and decisions are immutable'
                USING ERRCODE = '23514';
        END $$;
        CREATE TRIGGER feedback_split_suggestions_immutable
            BEFORE UPDATE OR DELETE ON feedback_split_suggestions
            FOR EACH ROW EXECUTE FUNCTION tp_feedback_split_fact_immutable();
        CREATE TRIGGER feedback_split_decisions_immutable
            BEFORE UPDATE OR DELETE ON feedback_split_decisions
            FOR EACH ROW EXECUTE FUNCTION tp_feedback_split_fact_immutable();
        CREATE FUNCTION tp_feedback_split_run_fixed() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN
            IF TG_OP = 'DELETE' THEN
                RAISE EXCEPTION 'Feedback split runs cannot be deleted' USING ERRCODE = '23514';
            END IF;
            IF ROW(NEW.id, NEW.project_id, NEW.batch_id, NEW.source_split_id, NEW.command_id,
                   NEW.request_hash, NEW.original_sha256, NEW.agent_config_version_id,
                   NEW.context_snapshot::text, NEW.configuration_snapshot::text, NEW.created_at)
               IS DISTINCT FROM
               ROW(OLD.id, OLD.project_id, OLD.batch_id, OLD.source_split_id, OLD.command_id,
                   OLD.request_hash, OLD.original_sha256, OLD.agent_config_version_id,
                   OLD.context_snapshot::text, OLD.configuration_snapshot::text, OLD.created_at)
               OR (OLD.job_id IS NOT NULL AND NEW.job_id IS DISTINCT FROM OLD.job_id) THEN
                RAISE EXCEPTION 'Feedback split run inputs are immutable' USING ERRCODE = '23514';
            END IF;
            RETURN NEW;
        END $$;
        CREATE TRIGGER feedback_split_runs_fixed BEFORE UPDATE OR DELETE ON feedback_split_runs
            FOR EACH ROW EXECUTE FUNCTION tp_feedback_split_run_fixed();
    """)


def downgrade() -> None:
    op.execute("""
        DO $$ BEGIN
            IF EXISTS (SELECT 1 FROM feedback_split_runs)
               OR EXISTS (SELECT 1 FROM jobs WHERE kind = 'feedback_decomposition')
               OR EXISTS (SELECT 1 FROM feedback_items
                          WHERE origin <> 'manual' OR status = 'withdrawn') THEN
                RAISE EXCEPTION '0016 cannot preserve feedback decomposition history';
            END IF;
        END $$;
    """)
    _job_kinds(False)
    op.execute("""
        DROP TRIGGER feedback_split_runs_fixed ON feedback_split_runs;
        DROP TRIGGER feedback_split_decisions_immutable ON feedback_split_decisions;
        DROP TRIGGER feedback_split_suggestions_immutable ON feedback_split_suggestions;
        DROP FUNCTION tp_feedback_split_run_fixed();
        DROP FUNCTION tp_feedback_split_fact_immutable();
    """)
    op.drop_index(
        op.f("ix_feedback_split_decisions_project_id"), table_name="feedback_split_decisions"
    )
    op.drop_table("feedback_split_decisions")
    op.drop_index(
        op.f("ix_feedback_split_suggestions_split_id"), table_name="feedback_split_suggestions"
    )
    op.drop_index(
        op.f("ix_feedback_split_suggestions_project_id"), table_name="feedback_split_suggestions"
    )
    op.drop_table("feedback_split_suggestions")
    op.drop_index(op.f("ix_feedback_split_runs_project_id"), table_name="feedback_split_runs")
    op.drop_index(op.f("ix_feedback_split_runs_batch_id"), table_name="feedback_split_runs")
    op.drop_table("feedback_split_runs")
    _item_status(False)
    op.drop_constraint(op.f("ck_feedback_items_origin_supported"), "feedback_items", type_="check")
    op.drop_column("feedback_items", "origin")


def _item_status(include_withdrawn: bool) -> None:
    statuses = "'open','processed','withdrawn'" if include_withdrawn else "'open','processed'"
    op.drop_constraint(op.f("ck_feedback_items_status_supported"), "feedback_items", type_="check")
    op.create_check_constraint(
        op.f("ck_feedback_items_status_supported"), "feedback_items", f"status IN ({statuses})"
    )


def _job_kinds(include_split: bool) -> None:
    suffix = ", 'feedback_decomposition'" if include_split else ""
    for table, name, kinds in (
        ("jobs", "ck_jobs_job_kind", BASE_KINDS),
        ("job_artifacts", "ck_job_artifacts_job_artifact_kind", BASE_ARTIFACTS),
    ):
        op.drop_constraint(op.f(name), table, type_="check")
        op.create_check_constraint(op.f(name), table, f"kind IN ({kinds}{suffix})")
