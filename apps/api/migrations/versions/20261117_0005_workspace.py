"""本机会话、工作区偏好与空白初稿来源。"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20261117_0005"
down_revision: str | None = "20261117_0004"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


ORIGINAL_SOURCES = "'local_import', 'manual_edit', 'ai_adoption', 'adoption_undo', 'version_revert'"


def replace_source_constraint(sources: str) -> None:
    name = op.f("ck_document_versions_source_supported")
    op.drop_constraint(name, "document_versions", type_="check")
    op.create_check_constraint(name, "document_versions", f"source IN ({sources})")


def upgrade() -> None:
    replace_source_constraint(ORIGINAL_SOURCES + ", 'blank'")
    op.create_table(
        "workspace_profiles",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("singleton", sa.Integer(), nullable=False),
        sa.Column("display_name", sa.String(80), nullable=False),
        sa.Column("notifications_enabled", sa.Boolean(), nullable=False),
        sa.Column("quiet_start", sa.String(5), nullable=False),
        sa.Column("quiet_end", sa.String(5), nullable=False),
        sa.Column("show_deferred", sa.Boolean(), nullable=False),
        sa.Column("version", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("id", name="pk_workspace_profiles"),
        sa.UniqueConstraint("singleton", name="uq_workspace_profiles_singleton"),
        sa.CheckConstraint("singleton = 1", name=op.f("ck_workspace_profiles_singleton_one")),
        sa.CheckConstraint("version >= 1", name=op.f("ck_workspace_profiles_version_positive")),
        sa.CheckConstraint(
            "length(trim(display_name)) >= 1",
            name=op.f("ck_workspace_profiles_display_name_nonempty"),
        ),
        sa.CheckConstraint(
            "length(display_name) <= 80", name=op.f("ck_workspace_profiles_display_name_length")
        ),
    )
    op.create_table(
        "workspace_sessions",
        sa.Column("token_hash", sa.String(64), nullable=False),
        sa.Column("workspace_id", sa.Uuid(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True),
        sa.PrimaryKeyConstraint("token_hash", name="pk_workspace_sessions"),
        sa.ForeignKeyConstraint(
            ["workspace_id"],
            ["workspace_profiles.id"],
            name="fk_workspace_sessions_workspace_id_workspace_profiles",
        ),
    )
    op.create_index("ix_workspace_sessions_expires_at", "workspace_sessions", ["expires_at"])


def downgrade() -> None:
    # An older schema cannot represent a blank initial version; never rewrite history to downgrade.
    replace_source_constraint(ORIGINAL_SOURCES)
    op.drop_table("workspace_sessions")
    op.drop_table("workspace_profiles")
