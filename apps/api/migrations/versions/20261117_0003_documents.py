"""Persist manuscript versions and an atomic current pointer.

Revision ID: 20261117_0003
Revises: 20261117_0002
"""

import sqlalchemy as sa
from alembic import op

revision = "20261117_0003"
down_revision = "20261117_0002"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "documents",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("project_id", sa.Uuid(), nullable=False),
        sa.Column("current_version", sa.BigInteger(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("id", name="pk_documents"),
        sa.UniqueConstraint("project_id", name="uq_documents_project_id"),
        sa.CheckConstraint("current_version BETWEEN 1 AND 9007199254740991", name="version_range"),
        sa.ForeignKeyConstraint(
            ["project_id"],
            ["projects.id"],
            name="fk_documents_project_id_projects",
            ondelete="RESTRICT",
        ),
    )
    op.create_table(
        "document_versions",
        sa.Column("document_id", sa.Uuid(), nullable=False),
        sa.Column("version", sa.BigInteger(), nullable=False),
        sa.Column("schema_version", sa.Integer(), nullable=False),
        sa.Column("content_json", sa.JSON(), nullable=False),
        sa.Column("source", sa.String(32), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("document_id", "version", name="pk_document_versions"),
        sa.CheckConstraint("version BETWEEN 1 AND 9007199254740991", name="version_range"),
        sa.CheckConstraint("schema_version = 1", name="schema_version_supported"),
        sa.CheckConstraint("source IN ('local_import', 'manual_edit')", name="source_supported"),
        sa.ForeignKeyConstraint(
            ["document_id"],
            ["documents.id"],
            name="fk_document_versions_document_id_documents",
            ondelete="RESTRICT",
        ),
    )
    op.create_foreign_key(
        "fk_documents_current_version_document_versions",
        "documents",
        "document_versions",
        ["id", "current_version"],
        ["document_id", "version"],
        deferrable=True,
        initially="DEFERRED",
    )
    op.execute("""
        CREATE FUNCTION thesis_pilot_immutable_document_version() RETURNS trigger
        LANGUAGE plpgsql AS $$
        BEGIN
            RAISE EXCEPTION 'Document versions are immutable' USING ERRCODE = '23514';
        END;
        $$
    """)
    op.execute("""
        CREATE TRIGGER document_versions_immutable
        BEFORE UPDATE OR DELETE ON document_versions
        FOR EACH ROW EXECUTE FUNCTION thesis_pilot_immutable_document_version()
    """)


def downgrade() -> None:
    # An operator may downgrade an empty test installation; application code never does.
    populated = op.get_bind().scalar(
        sa.text(
            "SELECT EXISTS (SELECT 1 FROM documents) OR EXISTS (SELECT 1 FROM document_versions)"
        )
    )
    if populated:
        raise RuntimeError("Refusing to remove persisted document history; use a forward migration")
    op.execute("DROP TRIGGER document_versions_immutable ON document_versions")
    op.execute("DROP FUNCTION thesis_pilot_immutable_document_version()")
    op.drop_constraint(
        "fk_documents_current_version_document_versions", "documents", type_="foreignkey"
    )
    op.drop_table("document_versions")
    op.drop_table("documents")
