"""四库不可变版本与真实配置试跑任务。"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20261117_0008"
down_revision: str | None = "20261117_0007"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "ai_configs",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("kind", sa.String(16), nullable=False),
        sa.Column("name", sa.String(200), nullable=False),
        sa.Column("version", sa.Integer(), nullable=False),
        sa.Column("enabled", sa.Boolean(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("id", name="pk_ai_configs"),
        sa.UniqueConstraint("kind", "name", name="uq_ai_configs_kind_name"),
        sa.CheckConstraint(
            "kind IN ('api', 'model', 'prompt', 'agent')", name=op.f("ck_ai_configs_kind_supported")
        ),
        sa.CheckConstraint("version >= 1", name=op.f("ck_ai_configs_version_positive")),
        sa.CheckConstraint("length(trim(name)) >= 1", name=op.f("ck_ai_configs_name_nonempty")),
        sa.CheckConstraint("length(name) <= 200", name=op.f("ck_ai_configs_name_length")),
    )
    op.create_table(
        "ai_config_versions",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("config_id", sa.Uuid(), nullable=False),
        sa.Column("version", sa.Integer(), nullable=False),
        sa.Column("name", sa.String(200), nullable=False),
        sa.Column("content", sa.JSON(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("id", name="pk_ai_config_versions"),
        sa.ForeignKeyConstraint(
            ["config_id"],
            ["ai_configs.id"],
            name="fk_ai_config_versions_config_id_ai_configs",
            ondelete="RESTRICT",
        ),
        sa.UniqueConstraint("config_id", "version", name="uq_ai_config_versions_config_version"),
        sa.CheckConstraint("version >= 1", name=op.f("ck_ai_config_versions_version_positive")),
        sa.CheckConstraint(
            "length(trim(name)) >= 1", name=op.f("ck_ai_config_versions_name_nonempty")
        ),
        sa.CheckConstraint("length(name) <= 200", name=op.f("ck_ai_config_versions_name_length")),
    )
    op.create_index("ix_ai_config_versions_config_id", "ai_config_versions", ["config_id"])
    op.drop_constraint(op.f("ck_jobs_job_kind"), "jobs", type_="check")
    op.create_check_constraint(
        op.f("ck_jobs_job_kind"),
        "jobs",
        "kind IN ('diagnostic', 'document_inspection', 'configuration_probe')",
    )
    op.drop_constraint(op.f("ck_job_artifacts_job_artifact_kind"), "job_artifacts", type_="check")
    op.create_check_constraint(
        op.f("ck_job_artifacts_job_artifact_kind"),
        "job_artifacts",
        "kind IN ('document_inspection', 'configuration_probe')",
    )


def downgrade() -> None:
    op.execute(
        """
        DO $$
        BEGIN
            IF EXISTS (SELECT 1 FROM ai_configs)
                OR EXISTS (SELECT 1 FROM jobs WHERE kind = 'configuration_probe') THEN
                RAISE EXCEPTION '0007 cannot preserve AI configuration versions or probe jobs';
            END IF;
        END
        $$
        """
    )
    op.drop_constraint(op.f("ck_job_artifacts_job_artifact_kind"), "job_artifacts", type_="check")
    op.create_check_constraint(
        op.f("ck_job_artifacts_job_artifact_kind"), "job_artifacts", "kind = 'document_inspection'"
    )
    op.drop_constraint(op.f("ck_jobs_job_kind"), "jobs", type_="check")
    op.create_check_constraint(
        op.f("ck_jobs_job_kind"), "jobs", "kind IN ('diagnostic', 'document_inspection')"
    )
    op.drop_index("ix_ai_config_versions_config_id", table_name="ai_config_versions")
    op.drop_table("ai_config_versions")
    op.drop_table("ai_configs")
