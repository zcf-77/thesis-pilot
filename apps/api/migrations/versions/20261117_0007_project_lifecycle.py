"""项目生命周期与不可变流程版本，保留已有项目和正文。"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20261117_0007"
down_revision: str | None = "20261117_0006"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "project_flows",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("name", sa.String(200), nullable=False),
        sa.Column("version", sa.Integer(), nullable=False),
        sa.Column("enabled", sa.Boolean(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("id", name="pk_project_flows"),
        sa.CheckConstraint("version >= 1", name=op.f("ck_project_flows_version_positive")),
        sa.CheckConstraint("length(trim(name)) >= 1", name=op.f("ck_project_flows_name_nonempty")),
        sa.CheckConstraint("length(name) <= 200", name=op.f("ck_project_flows_name_length")),
    )
    op.create_table(
        "project_flow_versions",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("flow_id", sa.Uuid(), nullable=False),
        sa.Column("version", sa.Integer(), nullable=False),
        sa.Column("name", sa.String(200), nullable=False),
        sa.Column("stages", sa.JSON(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("id", name="pk_project_flow_versions"),
        sa.ForeignKeyConstraint(
            ["flow_id"],
            ["project_flows.id"],
            name="fk_project_flow_versions_flow_id_project_flows",
            ondelete="RESTRICT",
        ),
        sa.UniqueConstraint("flow_id", "version", name="uq_project_flow_versions_flow_version"),
        sa.CheckConstraint("version >= 1", name=op.f("ck_project_flow_versions_version_positive")),
        sa.CheckConstraint(
            "length(trim(name)) >= 1", name=op.f("ck_project_flow_versions_name_nonempty")
        ),
        sa.CheckConstraint(
            "length(name) <= 200", name=op.f("ck_project_flow_versions_name_length")
        ),
    )
    op.create_index("ix_project_flow_versions_flow_id", "project_flow_versions", ["flow_id"])
    for column in (
        sa.Column("title", sa.String(500), nullable=False, server_default=""),
        sa.Column("deadline", sa.Date(), nullable=True),
        sa.Column("planning_mode", sa.String(16), nullable=False, server_default="none"),
        sa.Column("plan_note", sa.Text(), nullable=False, server_default=""),
        sa.Column("existing_artifacts", sa.Text(), nullable=False, server_default=""),
        sa.Column("archived", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("flow_version_id", sa.Uuid(), nullable=True),
        sa.Column("stage_id", sa.String(80), nullable=True),
    ):
        op.add_column("projects", column)
    for name in ("title", "planning_mode", "plan_note", "existing_artifacts", "archived"):
        op.alter_column("projects", name, server_default=None)
    op.create_foreign_key(
        "fk_projects_flow_version_id_project_flow_versions",
        "projects",
        "project_flow_versions",
        ["flow_version_id"],
        ["id"],
        ondelete="RESTRICT",
    )
    op.create_check_constraint(
        op.f("ck_projects_planning_mode"), "projects", "planning_mode IN ('none', 'personal')"
    )
    op.create_check_constraint(
        op.f("ck_projects_flow_binding_pair"),
        "projects",
        "(flow_version_id IS NULL AND stage_id IS NULL) OR "
        "(flow_version_id IS NOT NULL AND stage_id IS NOT NULL)",
    )


def downgrade() -> None:
    op.execute(
        """
        DO $$
        BEGIN
            IF EXISTS (SELECT 1 FROM project_flows)
                OR EXISTS (SELECT 1 FROM projects WHERE title <> '' OR deadline IS NOT NULL
                    OR planning_mode <> 'none' OR plan_note <> '' OR existing_artifacts <> ''
                    OR archived OR flow_version_id IS NOT NULL OR stage_id IS NOT NULL) THEN
                RAISE EXCEPTION '0006 cannot preserve project lifecycle or flow history';
            END IF;
        END
        $$
        """
    )
    op.drop_constraint(op.f("ck_projects_flow_binding_pair"), "projects", type_="check")
    op.drop_constraint(op.f("ck_projects_planning_mode"), "projects", type_="check")
    op.drop_constraint(
        "fk_projects_flow_version_id_project_flow_versions", "projects", type_="foreignkey"
    )
    for name in (
        "stage_id",
        "flow_version_id",
        "archived",
        "existing_artifacts",
        "plan_note",
        "planning_mode",
        "deadline",
        "title",
    ):
        op.drop_column("projects", name)
    op.drop_index("ix_project_flow_versions_flow_id", table_name="project_flow_versions")
    op.drop_table("project_flow_versions")
    op.drop_table("project_flows")
