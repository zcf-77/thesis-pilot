"""backups

Revision ID: 20261119_0021
Revises: 20261119_0020

SG-14: immutable project backup packages, restore uploads, and the project_backup /
project_restore job kinds. A restore job has no project until it commits the new copy.
"""

import sqlalchemy as sa
from alembic import op

revision = "20261119_0021"
down_revision = "20261119_0020"
branch_labels = None
depends_on = None

# Kinds allowed at 20261119_0020 (see jobs/models.py); the backup kinds are added on top.
BASE_KINDS = (
    "'diagnostic', 'document_inspection', 'configuration_probe', "
    "'material_parse', 'content_revision', 'document_export', 'change_record', 'review', "
    "'literature_search', 'feedback_decomposition', 'plan_adjustment'"
)
BASE_ARTIFACTS = (
    "'document_inspection', 'configuration_probe', 'material_parse', 'content_revision', "
    "'document_export', 'change_record', 'review', 'literature_search', "
    "'feedback_decomposition', 'plan_adjustment'"
)
BACKUP_KINDS = ", 'project_backup', 'project_restore'"


def upgrade() -> None:
    _job_kinds(True)
    op.alter_column("jobs", "project_id", existing_type=sa.Uuid(), nullable=True)
    op.create_check_constraint(
        op.f("ck_jobs_job_project_required"),
        "jobs",
        "project_id IS NOT NULL OR kind = 'project_restore'",
    )
    op.create_table(
        "backup_archives",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("project_id", sa.Uuid(), nullable=False),
        sa.Column("job_id", sa.Uuid(), nullable=False),
        sa.Column("attempt_id", sa.Uuid(), nullable=False),
        sa.Column("format", sa.String(length=32), nullable=False),
        sa.Column("schema_head", sa.String(length=64), nullable=False),
        sa.Column("filename", sa.String(length=200), nullable=False),
        sa.Column("sha256", sa.String(length=64), nullable=False),
        sa.Column("package_sha256", sa.String(length=64), nullable=False),
        sa.Column("byte_size", sa.Integer(), nullable=False),
        sa.Column("object_counts", sa.JSON(), nullable=False),
        sa.Column("data", sa.LargeBinary(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint(
            "byte_size BETWEEN 1 AND 268435456", name=op.f("ck_backup_archives_byte_size_bounded")
        ),
        sa.CheckConstraint(
            "format = 'thesispilot-backup/1'", name=op.f("ck_backup_archives_format_supported")
        ),
        sa.ForeignKeyConstraint(
            ["attempt_id"],
            ["job_attempts.id"],
            name=op.f("fk_backup_archives_attempt_id_job_attempts"),
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["job_id"],
            ["jobs.id"],
            name=op.f("fk_backup_archives_job_id_jobs"),
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["project_id"],
            ["projects.id"],
            name=op.f("fk_backup_archives_project_id_projects"),
            ondelete="RESTRICT",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_backup_archives")),
        sa.UniqueConstraint("attempt_id", name=op.f("uq_backup_archives_attempt_id")),
        sa.UniqueConstraint("job_id", name=op.f("uq_backup_archives_job_id")),
    )
    op.create_index(
        op.f("ix_backup_archives_project_id"), "backup_archives", ["project_id"], unique=False
    )
    op.create_table(
        "project_restores",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("job_id", sa.Uuid(), nullable=False),
        sa.Column("upload_key", sa.String(length=128), nullable=False),
        sa.Column("filename", sa.String(length=200), nullable=False),
        sa.Column("sha256", sa.String(length=64), nullable=False),
        sa.Column("byte_size", sa.Integer(), nullable=False),
        sa.Column("package_sha256", sa.String(length=64), nullable=False),
        sa.Column("source_project_id", sa.Uuid(), nullable=False),
        sa.Column("source_project_name", sa.String(length=200), nullable=False),
        sa.Column("schema_head", sa.String(length=64), nullable=False),
        sa.Column("exported_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("object_counts", sa.JSON(), nullable=False),
        sa.Column("result_project_id", sa.Uuid(), nullable=True),
        sa.Column("data", sa.LargeBinary(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint(
            "byte_size BETWEEN 1 AND 268435456", name=op.f("ck_project_restores_byte_size_bounded")
        ),
        sa.ForeignKeyConstraint(
            ["job_id"],
            ["jobs.id"],
            name=op.f("fk_project_restores_job_id_jobs"),
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["result_project_id"],
            ["projects.id"],
            name=op.f("fk_project_restores_result_project_id_projects"),
            ondelete="RESTRICT",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_project_restores")),
        sa.UniqueConstraint("job_id", name=op.f("uq_project_restores_job_id")),
        sa.UniqueConstraint(
            "result_project_id", name=op.f("uq_project_restores_result_project_id")
        ),
        sa.UniqueConstraint("upload_key", name=op.f("uq_project_restores_upload_key")),
    )
    op.execute("""
        CREATE FUNCTION tp_backup_archive_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN
            RAISE EXCEPTION 'Backup archives are immutable' USING ERRCODE = '23514';
        END $$;
        CREATE TRIGGER backup_archives_immutable BEFORE UPDATE OR DELETE ON backup_archives
            FOR EACH ROW EXECUTE FUNCTION tp_backup_archive_immutable();
        CREATE FUNCTION tp_project_restore_fixed() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN
            IF TG_OP = 'DELETE' THEN
                RAISE EXCEPTION 'Restore records cannot be deleted' USING ERRCODE = '23514';
            END IF;
            IF ROW(NEW.id, NEW.job_id, NEW.upload_key, NEW.filename, NEW.sha256, NEW.byte_size,
                   NEW.package_sha256, NEW.source_project_id, NEW.source_project_name,
                   NEW.schema_head, NEW.exported_at, NEW.object_counts::text, NEW.data,
                   NEW.created_at)
               IS DISTINCT FROM
               ROW(OLD.id, OLD.job_id, OLD.upload_key, OLD.filename, OLD.sha256, OLD.byte_size,
                   OLD.package_sha256, OLD.source_project_id, OLD.source_project_name,
                   OLD.schema_head, OLD.exported_at, OLD.object_counts::text, OLD.data,
                   OLD.created_at)
               OR (OLD.result_project_id IS NOT NULL
                   AND NEW.result_project_id IS DISTINCT FROM OLD.result_project_id) THEN
                RAISE EXCEPTION 'Restore uploads and results are immutable' USING ERRCODE = '23514';
            END IF;
            RETURN NEW;
        END $$;
        CREATE TRIGGER project_restores_fixed BEFORE UPDATE OR DELETE ON project_restores
            FOR EACH ROW EXECUTE FUNCTION tp_project_restore_fixed();
    """)


def downgrade() -> None:
    op.execute("""
        DO $$ BEGIN
            IF EXISTS (SELECT 1 FROM backup_archives)
               OR EXISTS (SELECT 1 FROM project_restores)
               OR EXISTS (SELECT 1 FROM jobs WHERE kind IN ('project_backup', 'project_restore'))
            THEN
                RAISE EXCEPTION '0020 cannot preserve backup packages or restore history';
            END IF;
        END $$;
    """)
    op.execute("""
        DROP TRIGGER project_restores_fixed ON project_restores;
        DROP TRIGGER backup_archives_immutable ON backup_archives;
        DROP FUNCTION tp_project_restore_fixed();
        DROP FUNCTION tp_backup_archive_immutable();
    """)
    op.drop_table("project_restores")
    op.drop_index(op.f("ix_backup_archives_project_id"), table_name="backup_archives")
    op.drop_table("backup_archives")
    op.drop_constraint(op.f("ck_jobs_job_project_required"), "jobs", type_="check")
    op.alter_column("jobs", "project_id", existing_type=sa.Uuid(), nullable=False)
    _job_kinds(False)


def _job_kinds(include_backups: bool) -> None:
    suffix = BACKUP_KINDS if include_backups else ""
    for table, name, kinds in (
        ("jobs", "ck_jobs_job_kind", BASE_KINDS),
        ("job_artifacts", "ck_job_artifacts_job_artifact_kind", BASE_ARTIFACTS),
    ):
        op.drop_constraint(op.f(name), table, type_="check")
        op.create_check_constraint(op.f(name), table, f"kind IN ({kinds}{suffix})")
