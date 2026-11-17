"""office_io

Revision ID: 20261119_0023
Revises: 20261119_0022

SG-22 slice D: DOCX import through the office-server sidecar and Word/PDF exports.
Adds the ``office_import`` job/artifact kind and manuscript version source, the immutable
``office_imports`` preview facts, the immutable ``document_office_sources`` binding of a
manuscript version to its imported original, and ``docx``/``pdf`` export files (binary,
up to 64 MiB, longer MIME type). Append-only: existing rows are never rewritten.
"""

import sqlalchemy as sa
from alembic import op

revision = "20261119_0023"
down_revision = "20261119_0022"
branch_labels = None
depends_on = None

# Kinds already allowed at 20261119_0022 (see jobs/models.py); office_import is added on top.
BASE_KINDS = (
    "'diagnostic', 'document_inspection', 'configuration_probe', "
    "'material_parse', 'content_revision', 'document_export', 'change_record', 'review', "
    "'literature_search', 'feedback_decomposition', 'plan_adjustment', "
    "'project_backup', 'project_restore'"
)
BASE_ARTIFACTS = (
    "'document_inspection', 'configuration_probe', 'material_parse', 'content_revision', "
    "'document_export', 'change_record', 'review', 'literature_search', "
    "'feedback_decomposition', 'plan_adjustment', 'project_backup', 'project_restore'"
)
SOURCES = (
    "'local_import', 'manual_edit', 'ai_adoption', 'adoption_undo', 'version_revert', "
    "'blank', 'schema_upgrade'"
)


def _replace_check(table: str, name: str, condition: str) -> None:
    constraint = op.f(f"ck_{table}_{name}")
    op.drop_constraint(constraint, table, type_="check")
    op.create_check_constraint(constraint, table, condition)


def _job_kinds(include_office: bool) -> None:
    suffix = ", 'office_import'" if include_office else ""
    _replace_check("jobs", "job_kind", f"kind IN ({BASE_KINDS}{suffix})")
    _replace_check("job_artifacts", "job_artifact_kind", f"kind IN ({BASE_ARTIFACTS}{suffix})")


def upgrade() -> None:
    _job_kinds(True)
    _replace_check(
        "document_versions", "source_supported", f"source IN ({SOURCES}, 'office_import')"
    )
    _replace_check(
        "export_files", "format_supported", "format IN ('html', 'txt', 'markdown', 'docx', 'pdf')"
    )
    _replace_check("export_files", "byte_size_bounded", "byte_size BETWEEN 1 AND 67108864")
    op.alter_column(
        "export_files",
        "content_type",
        existing_type=sa.String(length=64),
        type_=sa.String(length=128),
        existing_nullable=False,
    )
    op.create_table(
        "office_imports",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("project_id", sa.Uuid(), nullable=False),
        sa.Column("job_id", sa.Uuid(), nullable=False),
        sa.Column("attempt_id", sa.Uuid(), nullable=False),
        sa.Column("material_id", sa.Uuid(), nullable=False),
        sa.Column("original_id", sa.Uuid(), nullable=False),
        sa.Column("original_sha256", sa.String(length=64), nullable=False),
        sa.Column("filename", sa.String(length=255), nullable=False),
        sa.Column("converter", sa.String(length=32), nullable=False),
        sa.Column("snapshot", sa.JSON(), nullable=False),
        sa.Column("ir_map", sa.JSON(), nullable=False),
        sa.Column("losses", sa.JSON(), nullable=False),
        sa.Column("summary", sa.JSON(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(
            ["project_id"],
            ["projects.id"],
            name=op.f("fk_office_imports_project_id_projects"),
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["job_id"], ["jobs.id"], name=op.f("fk_office_imports_job_id_jobs"), ondelete="RESTRICT"
        ),
        sa.ForeignKeyConstraint(
            ["attempt_id"],
            ["job_attempts.id"],
            name=op.f("fk_office_imports_attempt_id_job_attempts"),
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["material_id"],
            ["materials.id"],
            name=op.f("fk_office_imports_material_id_materials"),
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["original_id"],
            ["material_originals.id"],
            name=op.f("fk_office_imports_original_id_material_originals"),
            ondelete="RESTRICT",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_office_imports")),
        sa.UniqueConstraint("job_id", name=op.f("uq_office_imports_job_id")),
        sa.UniqueConstraint("attempt_id", name=op.f("uq_office_imports_attempt_id")),
    )
    op.create_index(op.f("ix_office_imports_project_id"), "office_imports", ["project_id"])
    op.create_table(
        "document_office_sources",
        sa.Column("document_id", sa.Uuid(), nullable=False),
        sa.Column("document_version", sa.BigInteger(), nullable=False),
        sa.Column("import_id", sa.Uuid(), nullable=False),
        sa.Column("mode", sa.String(length=16), nullable=False),
        sa.Column("command_id", sa.Uuid(), nullable=False),
        sa.Column("request_hash", sa.String(length=64), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint(
            "document_version >= 1", name=op.f("ck_document_office_sources_version_positive")
        ),
        sa.CheckConstraint(
            "mode IN ('create', 'new_version')",
            name=op.f("ck_document_office_sources_mode_supported"),
        ),
        sa.ForeignKeyConstraint(
            ["document_id", "document_version"],
            ["document_versions.document_id", "document_versions.version"],
            name="fk_document_office_sources_document_version",
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["import_id"],
            ["office_imports.id"],
            name=op.f("fk_document_office_sources_import_id_office_imports"),
            ondelete="RESTRICT",
        ),
        sa.PrimaryKeyConstraint(
            "document_id", "document_version", name=op.f("pk_document_office_sources")
        ),
        sa.UniqueConstraint("command_id", name=op.f("uq_document_office_sources_command_id")),
    )
    op.create_index(
        op.f("ix_document_office_sources_import_id"), "document_office_sources", ["import_id"]
    )
    op.execute("""
        CREATE FUNCTION tp_office_fact_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN
            RAISE EXCEPTION 'Office imports and their manuscript bindings are immutable'
                USING ERRCODE = '23514';
        END $$
    """)
    for table in ("office_imports", "document_office_sources"):
        op.execute(
            f"CREATE TRIGGER {table}_immutable BEFORE UPDATE OR DELETE ON {table} "
            "FOR EACH ROW EXECUTE FUNCTION tp_office_fact_immutable()"
        )


def downgrade() -> None:
    # Refuse to lose imported originals' bindings, office jobs or binary exports.
    op.execute("""
        DO $$ BEGIN
            IF EXISTS (SELECT 1 FROM office_imports)
               OR EXISTS (SELECT 1 FROM document_office_sources)
               OR EXISTS (SELECT 1 FROM jobs WHERE kind = 'office_import')
               OR EXISTS (SELECT 1 FROM document_versions WHERE source = 'office_import')
               OR EXISTS (SELECT 1 FROM export_files WHERE format IN ('docx', 'pdf'))
            THEN
                RAISE EXCEPTION '0023 cannot be downgraded while office import/export data exists';
            END IF;
        END $$;
    """)
    for table in ("document_office_sources", "office_imports"):
        op.execute(f"DROP TRIGGER {table}_immutable ON {table}")
    op.execute("DROP FUNCTION tp_office_fact_immutable()")
    op.drop_index(op.f("ix_document_office_sources_import_id"), "document_office_sources")
    op.drop_table("document_office_sources")
    op.drop_index(op.f("ix_office_imports_project_id"), "office_imports")
    op.drop_table("office_imports")
    op.alter_column(
        "export_files",
        "content_type",
        existing_type=sa.String(length=128),
        type_=sa.String(length=64),
        existing_nullable=False,
    )
    _replace_check("export_files", "byte_size_bounded", "byte_size BETWEEN 1 AND 8388608")
    _replace_check("export_files", "format_supported", "format IN ('html', 'txt', 'markdown')")
    _replace_check("document_versions", "source_supported", f"source IN ({SOURCES})")
    _job_kinds(False)
