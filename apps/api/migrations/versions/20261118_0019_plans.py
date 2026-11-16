"""plans

Revision ID: 20261118_0019
Revises: 20261118_0018

SG-10: plan versions, AI plan-adjustment candidates and decisions, plus the workspace
reminder settings read by notification derivation.
"""

import sqlalchemy as sa
from alembic import op

revision = "20261118_0019"
down_revision = "20261118_0018"
branch_labels = None
depends_on = None

# Kinds already allowed at 20261118_0018 (see jobs/models.py); plan_adjustment is added on top.
BASE_KINDS = (
    "'diagnostic', 'document_inspection', 'configuration_probe', "
    "'material_parse', 'content_revision', 'document_export', 'change_record', 'review', "
    "'literature_search', 'feedback_decomposition'"
)
BASE_ARTIFACTS = (
    "'document_inspection', 'configuration_probe', 'material_parse', 'content_revision', "
    "'document_export', 'change_record', 'review', 'literature_search', "
    "'feedback_decomposition'"
)


def upgrade() -> None:
    op.create_table(
        "reminder_settings",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("singleton", sa.Integer(), nullable=False),
        sa.Column("enabled", sa.Boolean(), nullable=False),
        sa.Column("cooldown_hours", sa.Integer(), nullable=False),
        sa.Column("overdue_days", sa.Integer(), nullable=False),
        sa.Column("version", sa.Integer(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint(
            "cooldown_hours BETWEEN 1 AND 168", name=op.f("ck_reminder_settings_cooldown_range")
        ),
        sa.CheckConstraint(
            "overdue_days BETWEEN 1 AND 30", name=op.f("ck_reminder_settings_overdue_range")
        ),
        sa.CheckConstraint("singleton = 1", name=op.f("ck_reminder_settings_singleton_one")),
        sa.CheckConstraint("version >= 1", name=op.f("ck_reminder_settings_version_positive")),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_reminder_settings")),
        sa.UniqueConstraint("singleton", name=op.f("uq_reminder_settings_singleton")),
    )
    op.create_table(
        "plan_adjustments",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("project_id", sa.Uuid(), nullable=False),
        sa.Column("job_id", sa.Uuid(), nullable=True),
        sa.Column("command_id", sa.Uuid(), nullable=False),
        sa.Column("request_hash", sa.String(length=64), nullable=False),
        sa.Column("agent_config_version_id", sa.Uuid(), nullable=False),
        sa.Column("base_plan_version", sa.Integer(), nullable=False),
        sa.Column("input_snapshot", sa.JSON(), nullable=False),
        sa.Column("configuration_snapshot", sa.JSON(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint(
            "base_plan_version >= 0", name=op.f("ck_plan_adjustments_base_version_nonnegative")
        ),
        sa.ForeignKeyConstraint(
            ["job_id"],
            ["jobs.id"],
            name=op.f("fk_plan_adjustments_job_id_jobs"),
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["project_id"],
            ["projects.id"],
            name=op.f("fk_plan_adjustments_project_id_projects"),
            ondelete="RESTRICT",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_plan_adjustments")),
        sa.UniqueConstraint("command_id", name=op.f("uq_plan_adjustments_command_id")),
        sa.UniqueConstraint("job_id", name=op.f("uq_plan_adjustments_job_id")),
    )
    op.create_index(
        op.f("ix_plan_adjustments_project_id"), "plan_adjustments", ["project_id"], unique=False
    )
    op.create_table(
        "plan_proposals",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("adjustment_id", sa.Uuid(), nullable=False),
        sa.Column("project_id", sa.Uuid(), nullable=False),
        sa.Column("job_id", sa.Uuid(), nullable=False),
        sa.Column("requested_model", sa.String(length=200), nullable=False),
        sa.Column("response_model", sa.String(length=200), nullable=False),
        sa.Column("content", sa.JSON(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(
            ["adjustment_id"],
            ["plan_adjustments.id"],
            name=op.f("fk_plan_proposals_adjustment_id_plan_adjustments"),
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["job_id"], ["jobs.id"], name=op.f("fk_plan_proposals_job_id_jobs"), ondelete="RESTRICT"
        ),
        sa.ForeignKeyConstraint(
            ["project_id"],
            ["projects.id"],
            name=op.f("fk_plan_proposals_project_id_projects"),
            ondelete="RESTRICT",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_plan_proposals")),
        sa.UniqueConstraint("adjustment_id", name=op.f("uq_plan_proposals_adjustment_id")),
        sa.UniqueConstraint("job_id", name=op.f("uq_plan_proposals_job_id")),
    )
    op.create_index(
        op.f("ix_plan_proposals_project_id"), "plan_proposals", ["project_id"], unique=False
    )
    op.create_table(
        "plan_versions",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("project_id", sa.Uuid(), nullable=False),
        sa.Column("version", sa.Integer(), nullable=False),
        sa.Column("action", sa.String(length=16), nullable=False),
        sa.Column("reason", sa.String(length=500), nullable=False),
        sa.Column("adjustment_id", sa.Uuid(), nullable=True),
        sa.Column("changes", sa.JSON(), nullable=False),
        sa.Column("tasks", sa.JSON(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint(
            "action IN ('adopt','revert','manual')", name=op.f("ck_plan_versions_action_supported")
        ),
        sa.CheckConstraint("version >= 1", name=op.f("ck_plan_versions_version_positive")),
        sa.ForeignKeyConstraint(
            ["adjustment_id"],
            ["plan_adjustments.id"],
            name=op.f("fk_plan_versions_adjustment_id_plan_adjustments"),
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["project_id"],
            ["projects.id"],
            name=op.f("fk_plan_versions_project_id_projects"),
            ondelete="RESTRICT",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_plan_versions")),
        sa.UniqueConstraint("project_id", "version", name="uq_plan_versions_project_version"),
    )
    op.create_index(
        op.f("ix_plan_versions_project_id"), "plan_versions", ["project_id"], unique=False
    )
    op.create_table(
        "plan_decisions",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("adjustment_id", sa.Uuid(), nullable=False),
        sa.Column("project_id", sa.Uuid(), nullable=False),
        sa.Column("action", sa.String(length=16), nullable=False),
        sa.Column("accepted_item_ids", sa.JSON(), nullable=False),
        sa.Column("rejected_item_ids", sa.JSON(), nullable=False),
        sa.Column("plan_version", sa.Integer(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint(
            "action IN ('adopt','keep','revert')", name=op.f("ck_plan_decisions_action_supported")
        ),
        sa.ForeignKeyConstraint(
            ["adjustment_id"],
            ["plan_adjustments.id"],
            name=op.f("fk_plan_decisions_adjustment_id_plan_adjustments"),
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["project_id"],
            ["projects.id"],
            name=op.f("fk_plan_decisions_project_id_projects"),
            ondelete="RESTRICT",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_plan_decisions")),
        sa.UniqueConstraint("adjustment_id", "action", name="uq_plan_decisions_adjustment_action"),
    )
    op.create_index(
        op.f("ix_plan_decisions_adjustment_id"), "plan_decisions", ["adjustment_id"], unique=False
    )
    op.create_index(
        op.f("ix_plan_decisions_project_id"), "plan_decisions", ["project_id"], unique=False
    )
    _job_kinds(True)
    op.execute("""
        CREATE FUNCTION tp_plan_history_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN
            RAISE EXCEPTION 'Plan history is immutable' USING ERRCODE = '23514';
        END $$;
        CREATE TRIGGER plan_versions_immutable BEFORE UPDATE OR DELETE ON plan_versions
            FOR EACH ROW EXECUTE FUNCTION tp_plan_history_immutable();
        CREATE TRIGGER plan_proposals_immutable BEFORE UPDATE OR DELETE ON plan_proposals
            FOR EACH ROW EXECUTE FUNCTION tp_plan_history_immutable();
        CREATE TRIGGER plan_decisions_immutable BEFORE UPDATE OR DELETE ON plan_decisions
            FOR EACH ROW EXECUTE FUNCTION tp_plan_history_immutable();
        CREATE FUNCTION tp_plan_adjustment_fixed() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN
            IF TG_OP = 'DELETE' THEN
                RAISE EXCEPTION 'Plan adjustments cannot be deleted' USING ERRCODE = '23514';
            END IF;
            IF ROW(NEW.id, NEW.project_id, NEW.command_id, NEW.request_hash,
                   NEW.agent_config_version_id, NEW.base_plan_version,
                   NEW.input_snapshot::text, NEW.configuration_snapshot::text, NEW.created_at)
               IS DISTINCT FROM
               ROW(OLD.id, OLD.project_id, OLD.command_id, OLD.request_hash,
                   OLD.agent_config_version_id, OLD.base_plan_version,
                   OLD.input_snapshot::text, OLD.configuration_snapshot::text, OLD.created_at)
               OR (OLD.job_id IS NOT NULL AND NEW.job_id IS DISTINCT FROM OLD.job_id) THEN
                RAISE EXCEPTION 'Plan adjustment inputs are immutable' USING ERRCODE = '23514';
            END IF;
            RETURN NEW;
        END $$;
        CREATE TRIGGER plan_adjustments_fixed BEFORE UPDATE OR DELETE ON plan_adjustments
            FOR EACH ROW EXECUTE FUNCTION tp_plan_adjustment_fixed();
    """)


def downgrade() -> None:
    op.execute("""
        DO $$ BEGIN
            IF EXISTS (SELECT 1 FROM plan_adjustments)
               OR EXISTS (SELECT 1 FROM plan_versions)
               OR EXISTS (SELECT 1 FROM jobs WHERE kind = 'plan_adjustment') THEN
                RAISE EXCEPTION '0018 cannot preserve plan history';
            END IF;
        END $$;
    """)
    _job_kinds(False)
    op.drop_index(op.f("ix_plan_decisions_project_id"), table_name="plan_decisions")
    op.drop_index(op.f("ix_plan_decisions_adjustment_id"), table_name="plan_decisions")
    op.drop_table("plan_decisions")
    op.drop_index(op.f("ix_plan_versions_project_id"), table_name="plan_versions")
    op.drop_table("plan_versions")
    op.drop_index(op.f("ix_plan_proposals_project_id"), table_name="plan_proposals")
    op.drop_table("plan_proposals")
    op.drop_index(op.f("ix_plan_adjustments_project_id"), table_name="plan_adjustments")
    op.drop_table("plan_adjustments")
    op.drop_table("reminder_settings")
    op.execute(
        "DROP FUNCTION tp_plan_history_immutable(); DROP FUNCTION tp_plan_adjustment_fixed();"
    )


def _job_kinds(include_plan: bool) -> None:
    suffix = ", 'plan_adjustment'" if include_plan else ""
    for table, name, kinds in (
        ("jobs", "ck_jobs_job_kind", BASE_KINDS),
        ("job_artifacts", "ck_job_artifacts_job_artifact_kind", BASE_ARTIFACTS),
    ):
        op.drop_constraint(op.f(name), table, type_="check")
        op.create_check_constraint(op.f(name), table, f"kind IN ({kinds}{suffix})")
