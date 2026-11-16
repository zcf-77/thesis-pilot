"""exports: fixed-version document exports and change records

Revision ID: 20261118_0015
Revises: 20261118_0014
"""

import sqlalchemy as sa
from alembic import op

revision = "20261118_0015"
down_revision = "20261118_0014"
branch_labels = None
depends_on = None

BASE_JOB_KINDS = (
    "'diagnostic', 'document_inspection', 'configuration_probe', 'material_parse', "
    "'content_revision'"
)
BASE_ARTIFACT_KINDS = (
    "'document_inspection', 'configuration_probe', 'material_parse', 'content_revision'"
)
EXPORT_KINDS = ", 'document_export', 'change_record'"


def _job_kinds(include_exports: bool) -> None:
    suffix = EXPORT_KINDS if include_exports else ""
    for table, name, kinds in (
        ("jobs", "ck_jobs_job_kind", BASE_JOB_KINDS),
        ("job_artifacts", "ck_job_artifacts_job_artifact_kind", BASE_ARTIFACT_KINDS),
    ):
        op.drop_constraint(op.f(name), table, type_="check")
        op.create_check_constraint(op.f(name), table, f"kind IN ({kinds}{suffix})")


def upgrade() -> None:
    _job_kinds(True)
    op.create_table(
        "export_files",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("project_id", sa.Uuid(), nullable=False),
        sa.Column("job_id", sa.Uuid(), nullable=False),
        sa.Column("attempt_id", sa.Uuid(), nullable=False),
        sa.Column("kind", sa.String(length=32), nullable=False),
        sa.Column("format", sa.String(length=16), nullable=False),
        sa.Column("document_id", sa.Uuid(), nullable=False),
        sa.Column("document_version", sa.BigInteger(), nullable=False),
        sa.Column("from_version", sa.BigInteger(), nullable=True),
        sa.Column("filename", sa.String(length=200), nullable=False),
        sa.Column("content_type", sa.String(length=64), nullable=False),
        sa.Column("sha256", sa.String(length=64), nullable=False),
        sa.Column("byte_size", sa.Integer(), nullable=False),
        sa.Column("data", sa.LargeBinary(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint(
            "byte_size BETWEEN 1 AND 8388608", name=op.f("ck_export_files_byte_size_bounded")
        ),
        sa.CheckConstraint(
            "format IN ('html', 'txt', 'markdown')", name=op.f("ck_export_files_format_supported")
        ),
        sa.CheckConstraint(
            "kind IN ('document_export', 'change_record')",
            name=op.f("ck_export_files_kind_supported"),
        ),
        sa.CheckConstraint(
            "(kind = 'change_record') = (from_version IS NOT NULL)",
            name=op.f("ck_export_files_range_reference"),
        ),
        sa.CheckConstraint(
            "from_version IS NULL OR from_version BETWEEN 1 AND document_version",
            name=op.f("ck_export_files_range_ordered"),
        ),
        sa.CheckConstraint("document_version >= 1", name=op.f("ck_export_files_version_positive")),
        sa.ForeignKeyConstraint(
            ["attempt_id"],
            ["job_attempts.id"],
            name=op.f("fk_export_files_attempt_id_job_attempts"),
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["document_id"],
            ["documents.id"],
            name=op.f("fk_export_files_document_id_documents"),
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["job_id"], ["jobs.id"], name=op.f("fk_export_files_job_id_jobs"), ondelete="RESTRICT"
        ),
        sa.ForeignKeyConstraint(
            ["project_id"],
            ["projects.id"],
            name=op.f("fk_export_files_project_id_projects"),
            ondelete="RESTRICT",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_export_files")),
        sa.UniqueConstraint("attempt_id", name=op.f("uq_export_files_attempt_id")),
        sa.UniqueConstraint("job_id", name=op.f("uq_export_files_job_id")),
    )
    op.create_index(
        op.f("ix_export_files_project_id"), "export_files", ["project_id"], unique=False
    )
    op.execute("""
        CREATE FUNCTION tp_export_file_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN
            RAISE EXCEPTION 'Export files are immutable' USING ERRCODE = '23514';
        END $$;
        CREATE TRIGGER export_files_immutable BEFORE UPDATE OR DELETE ON export_files
            FOR EACH ROW EXECUTE FUNCTION tp_export_file_immutable();
    """)


def downgrade() -> None:
    op.execute("""
        DO $$ BEGIN
            IF EXISTS (SELECT 1 FROM jobs WHERE kind IN ('document_export', 'change_record')) THEN
                RAISE EXCEPTION '0012 cannot preserve export jobs and files';
            END IF;
        END $$;
    """)
    op.execute("DROP TRIGGER export_files_immutable ON export_files")
    op.drop_index(op.f("ix_export_files_project_id"), table_name="export_files")
    op.drop_table("export_files")
    op.execute("DROP FUNCTION tp_export_file_immutable()")
    _job_kinds(False)
