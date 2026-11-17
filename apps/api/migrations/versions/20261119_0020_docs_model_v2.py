"""docs_model_v2

Revision ID: 20261119_0020
Revises: 20261118_0019

SG-22: manuscript snapshot schema v2 (MuffinOffice DocsModel + protections + derived
chapters). Explicit, versioned and append-only: existing rows are never rewritten.
Adds the ``schema_upgrade`` version source, the audited ``document_schema_upgrades``
record, the candidate base-schema column, the source guard v2 contract value and the
content-addressed ``document_resources`` table.
"""

import sqlalchemy as sa
from alembic import op

revision = "20261119_0020"
down_revision = "20261118_0019"
branch_labels = None
depends_on = None

SOURCES = "'local_import', 'manual_edit', 'ai_adoption', 'adoption_undo', 'version_revert', 'blank'"
GUARDS = "'source-projection-v1', 'source-projection-v2'"


def _replace_check(table: str, name: str, condition: str) -> None:
    constraint = op.f(f"ck_{table}_{name}")
    op.drop_constraint(constraint, table, type_="check")
    op.create_check_constraint(constraint, table, condition)


def upgrade() -> None:
    _replace_check("document_versions", "schema_version_supported", "schema_version IN (1, 2)")
    _replace_check(
        "document_versions", "source_supported", f"source IN ({SOURCES}, 'schema_upgrade')"
    )
    op.create_check_constraint(
        op.f("ck_document_source_versions_guard_version_supported"),
        "document_source_versions",
        f"guard_version IN ({GUARDS}, 'source-model-v2')",
    )
    for table in ("revision_candidates", "format_candidates"):
        op.add_column(
            table,
            sa.Column(
                "content_schema_version",
                sa.Integer(),
                nullable=False,
                server_default=sa.text("1"),
            ),
        )
        op.create_check_constraint(
            op.f(f"ck_{table}_content_schema_supported"),
            table,
            "content_schema_version IN (1, 2)",
        )
    op.create_table(
        "document_schema_upgrades",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("document_id", sa.Uuid(), nullable=False),
        sa.Column("command_id", sa.Uuid(), nullable=False),
        sa.Column("request_hash", sa.String(length=64), nullable=False),
        sa.Column("from_version", sa.BigInteger(), nullable=False),
        sa.Column("to_version", sa.BigInteger(), nullable=False),
        sa.Column("from_schema_version", sa.Integer(), nullable=False),
        sa.Column("to_schema_version", sa.Integer(), nullable=False),
        sa.Column("converter_version", sa.String(length=64), nullable=False),
        sa.Column("converter_sha256", sa.String(length=64), nullable=False),
        sa.Column("loss_report", sa.JSON(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint(
            "to_version = from_version + 1", name=op.f("ck_document_schema_upgrades_next_version")
        ),
        sa.CheckConstraint(
            "from_schema_version = 1 AND to_schema_version = 2",
            name=op.f("ck_document_schema_upgrades_schema_direction"),
        ),
        sa.ForeignKeyConstraint(
            ["document_id"],
            ["documents.id"],
            name=op.f("fk_document_schema_upgrades_document_id_documents"),
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["document_id", "from_version"],
            ["document_versions.document_id", "document_versions.version"],
            name="fk_document_schema_upgrades_from_version",
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["document_id", "to_version"],
            ["document_versions.document_id", "document_versions.version"],
            name="fk_document_schema_upgrades_to_version",
            ondelete="RESTRICT",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_document_schema_upgrades")),
        sa.UniqueConstraint("command_id", name="uq_document_schema_upgrades_command_id"),
        sa.UniqueConstraint("document_id", name="uq_document_schema_upgrades_document_id"),
    )
    op.create_table(
        "document_resources",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("project_id", sa.Uuid(), nullable=False),
        sa.Column("sha256", sa.String(length=64), nullable=False),
        sa.Column("mime", sa.String(length=32), nullable=False),
        sa.Column("byte_size", sa.Integer(), nullable=False),
        sa.Column("width_px", sa.Integer(), nullable=True),
        sa.Column("height_px", sa.Integer(), nullable=True),
        sa.Column("content", sa.LargeBinary(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint(
            "byte_size BETWEEN 1 AND 10485760", name=op.f("ck_document_resources_byte_size_range")
        ),
        sa.CheckConstraint(
            "mime IN ('image/png', 'image/jpeg', 'image/gif', 'image/webp')",
            name=op.f("ck_document_resources_mime_supported"),
        ),
        sa.ForeignKeyConstraint(
            ["project_id"],
            ["projects.id"],
            name=op.f("fk_document_resources_project_id_projects"),
            ondelete="RESTRICT",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_document_resources")),
        sa.UniqueConstraint("project_id", "sha256", name="uq_document_resources_project_sha256"),
    )
    op.execute("""
        CREATE FUNCTION tp_docs_v2_fact_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN
            RAISE EXCEPTION 'Schema upgrades and document resources are immutable'
                USING ERRCODE = '23514';
        END $$
    """)
    for table in ("document_schema_upgrades", "document_resources"):
        op.execute(
            f"CREATE TRIGGER {table}_immutable BEFORE UPDATE OR DELETE ON {table} "
            "FOR EACH ROW EXECUTE FUNCTION tp_docs_v2_fact_immutable()"
        )


def downgrade() -> None:
    # Refuse to lose v2 manuscripts, upgrade audit records, resources or v2 guards.
    op.execute("""
        DO $$ BEGIN
            IF EXISTS (SELECT 1 FROM document_versions
                       WHERE schema_version <> 1 OR source = 'schema_upgrade')
               OR EXISTS (SELECT 1 FROM document_schema_upgrades)
               OR EXISTS (SELECT 1 FROM document_resources)
               OR EXISTS (SELECT 1 FROM document_source_versions
                          WHERE guard_version = 'source-model-v2')
               OR EXISTS (SELECT 1 FROM revision_candidates WHERE content_schema_version <> 1)
               OR EXISTS (SELECT 1 FROM format_candidates WHERE content_schema_version <> 1)
            THEN
                RAISE EXCEPTION '0020 cannot be downgraded while v2 manuscript data exists';
            END IF;
        END $$;
    """)
    for table in ("document_resources", "document_schema_upgrades"):
        op.execute(f"DROP TRIGGER {table}_immutable ON {table}")
    op.execute("DROP FUNCTION tp_docs_v2_fact_immutable()")
    op.drop_table("document_resources")
    op.drop_table("document_schema_upgrades")
    for table in ("format_candidates", "revision_candidates"):
        op.drop_constraint(op.f(f"ck_{table}_content_schema_supported"), table, type_="check")
        op.drop_column(table, "content_schema_version")
    op.drop_constraint(
        op.f("ck_document_source_versions_guard_version_supported"),
        "document_source_versions",
        type_="check",
    )
    _replace_check("document_versions", "source_supported", f"source IN ({SOURCES})")
    _replace_check("document_versions", "schema_version_supported", "schema_version = 1")
