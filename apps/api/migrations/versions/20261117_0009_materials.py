"""不可变原件、解析版本与项目来源绑定。

Revision ID: 20261117_0009
Revises: 20261117_0008
"""

import sqlalchemy as sa
from alembic import op

revision = "20261117_0009"
down_revision = "20261117_0008"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "materials",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("project_id", sa.Uuid(), nullable=False),
        sa.Column("name", sa.String(length=200), nullable=False),
        sa.Column("kind", sa.String(length=16), nullable=False),
        sa.Column("source_note", sa.Text(), nullable=False),
        sa.Column("version", sa.Integer(), nullable=False),
        sa.Column("linked", sa.Boolean(), nullable=False),
        sa.Column("removed", sa.Boolean(), nullable=False),
        sa.Column("current_original_id", sa.Uuid(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint(
            "kind IN ('template', 'requirements', 'literature', 'other')",
            name=op.f("ck_materials_kind_supported"),
        ),
        sa.CheckConstraint(
            "length(trim(name)) >= 1 AND length(name) <= 200", name=op.f("ck_materials_name_valid")
        ),
        sa.CheckConstraint("version >= 1", name=op.f("ck_materials_version_positive")),
        sa.ForeignKeyConstraint(
            ["project_id"],
            ["projects.id"],
            name=op.f("fk_materials_project_id_projects"),
            ondelete="RESTRICT",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_materials")),
    )
    op.create_index(op.f("ix_materials_project_id"), "materials", ["project_id"], unique=False)
    op.create_table(
        "project_source_bindings",
        sa.Column("project_id", sa.Uuid(), nullable=False),
        sa.Column("version", sa.Integer(), nullable=False),
        sa.Column("current_version_id", sa.Uuid(), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint(
            "version >= 1", name=op.f("ck_project_source_bindings_version_positive")
        ),
        sa.ForeignKeyConstraint(
            ["project_id"],
            ["projects.id"],
            name=op.f("fk_project_source_bindings_project_id_projects"),
            ondelete="RESTRICT",
        ),
        sa.PrimaryKeyConstraint("project_id", name=op.f("pk_project_source_bindings")),
    )
    op.create_table(
        "material_originals",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("material_id", sa.Uuid(), nullable=False),
        sa.Column("version", sa.Integer(), nullable=False),
        sa.Column("filename", sa.String(length=255), nullable=False),
        sa.Column("file_type", sa.String(length=16), nullable=False),
        sa.Column("sha256", sa.String(length=64), nullable=False),
        sa.Column("byte_size", sa.Integer(), nullable=False),
        sa.Column("data", sa.LargeBinary(), nullable=False),
        sa.Column("upload_key", sa.String(length=128), nullable=False),
        sa.Column("request_hash", sa.String(length=64), nullable=False),
        sa.Column("initial_job_id", sa.Uuid(), nullable=True),
        sa.Column("latest_parse_id", sa.Uuid(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint(
            "file_type IN ('docx', 'text', 'pdf')",
            name=op.f("ck_material_originals_file_type_supported"),
        ),
        sa.CheckConstraint(
            "byte_size BETWEEN 1 AND 8388608", name=op.f("ck_material_originals_byte_size_bounded")
        ),
        sa.CheckConstraint("version >= 1", name=op.f("ck_material_originals_version_positive")),
        sa.ForeignKeyConstraint(
            ["initial_job_id"],
            ["jobs.id"],
            name=op.f("fk_material_originals_initial_job_id_jobs"),
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["material_id"],
            ["materials.id"],
            name=op.f("fk_material_originals_material_id_materials"),
            ondelete="RESTRICT",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_material_originals")),
        sa.UniqueConstraint(
            "material_id", "version", name="uq_material_originals_material_version"
        ),
        sa.UniqueConstraint("upload_key", name=op.f("uq_material_originals_upload_key")),
    )
    op.create_index(
        op.f("ix_material_originals_material_id"),
        "material_originals",
        ["material_id"],
        unique=False,
    )
    op.create_table(
        "material_parse_versions",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("original_id", sa.Uuid(), nullable=False),
        sa.Column("version", sa.Integer(), nullable=False),
        sa.Column("status", sa.String(length=16), nullable=False),
        sa.Column("source_job_id", sa.Uuid(), nullable=False),
        sa.Column("content", sa.JSON(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint(
            "version >= 1", name=op.f("ck_material_parse_versions_version_positive")
        ),
        sa.ForeignKeyConstraint(
            ["original_id"],
            ["material_originals.id"],
            name=op.f("fk_material_parse_versions_original_id_material_originals"),
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["source_job_id"],
            ["jobs.id"],
            name=op.f("fk_material_parse_versions_source_job_id_jobs"),
            ondelete="RESTRICT",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_material_parse_versions")),
        sa.UniqueConstraint(
            "original_id", "version", name="uq_material_parse_versions_original_version"
        ),
        sa.UniqueConstraint("source_job_id", name=op.f("uq_material_parse_versions_source_job_id")),
    )
    op.create_index(
        op.f("ix_material_parse_versions_original_id"),
        "material_parse_versions",
        ["original_id"],
        unique=False,
    )
    op.create_table(
        "project_source_binding_versions",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("project_id", sa.Uuid(), nullable=False),
        sa.Column("version", sa.Integer(), nullable=False),
        sa.Column("template_parse_version_id", sa.Uuid(), nullable=True),
        sa.Column("requirement_parse_version_ids", sa.JSON(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint(
            "version >= 1", name=op.f("ck_project_source_binding_versions_version_positive")
        ),
        sa.ForeignKeyConstraint(
            ["project_id"],
            ["projects.id"],
            name=op.f("fk_project_source_binding_versions_project_id_projects"),
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["template_parse_version_id"],
            ["material_parse_versions.id"],
            name=op.f(
                "fk_project_source_binding_versions_template_parse_version_id_material_parse_versions"
            ),
            ondelete="RESTRICT",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_project_source_binding_versions")),
        sa.UniqueConstraint(
            "project_id", "version", name="uq_project_source_binding_versions_project_version"
        ),
    )
    op.create_index(
        op.f("ix_project_source_binding_versions_project_id"),
        "project_source_binding_versions",
        ["project_id"],
        unique=False,
    )
    op.create_foreign_key(
        op.f("fk_materials_current_original_id_material_originals"),
        "materials",
        "material_originals",
        ["current_original_id"],
        ["id"],
        ondelete="RESTRICT",
    )
    op.create_foreign_key(
        op.f("fk_material_originals_latest_parse_id_material_parse_versions"),
        "material_originals",
        "material_parse_versions",
        ["latest_parse_id"],
        ["id"],
        ondelete="RESTRICT",
    )
    op.create_foreign_key(
        op.f("fk_project_source_bindings_current_version_id_project_source_binding_versions"),
        "project_source_bindings",
        "project_source_binding_versions",
        ["current_version_id"],
        ["id"],
        ondelete="RESTRICT",
    )
    op.drop_constraint(op.f("ck_jobs_job_kind"), "jobs", type_="check")
    op.create_check_constraint(
        op.f("ck_jobs_job_kind"),
        "jobs",
        "kind IN ('diagnostic', 'document_inspection', 'configuration_probe', 'material_parse')",
    )
    op.drop_constraint(op.f("ck_job_artifacts_job_artifact_kind"), "job_artifacts", type_="check")
    op.create_check_constraint(
        op.f("ck_job_artifacts_job_artifact_kind"),
        "job_artifacts",
        "kind IN ('document_inspection', 'configuration_probe', 'material_parse')",
    )
    op.execute("""
        CREATE FUNCTION tp_protect_material_original() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN
            IF TG_OP = 'DELETE' THEN
                RAISE EXCEPTION 'material original is immutable';
            END IF;
            IF ROW(OLD.id, OLD.material_id, OLD.version, OLD.filename, OLD.file_type,
                   OLD.sha256, OLD.byte_size, OLD.data, OLD.upload_key,
                   OLD.request_hash, OLD.created_at)
               IS DISTINCT FROM
               ROW(NEW.id, NEW.material_id, NEW.version, NEW.filename, NEW.file_type,
                   NEW.sha256, NEW.byte_size, NEW.data, NEW.upload_key,
                   NEW.request_hash, NEW.created_at)
               OR (OLD.initial_job_id IS NOT NULL
                   AND OLD.initial_job_id IS DISTINCT FROM NEW.initial_job_id) THEN
                RAISE EXCEPTION 'material original is immutable';
            END IF;
            RETURN NEW;
        END $$;
        CREATE TRIGGER material_original_immutable BEFORE UPDATE OR DELETE ON material_originals
            FOR EACH ROW EXECUTE FUNCTION tp_protect_material_original();
        CREATE FUNCTION tp_protect_material_snapshot() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN
            RAISE EXCEPTION 'material snapshot is immutable';
        END $$;
        CREATE TRIGGER material_parse_immutable BEFORE UPDATE OR DELETE ON material_parse_versions
            FOR EACH ROW EXECUTE FUNCTION tp_protect_material_snapshot();
        CREATE TRIGGER source_binding_version_immutable
            BEFORE UPDATE OR DELETE ON project_source_binding_versions
            FOR EACH ROW EXECUTE FUNCTION tp_protect_material_snapshot();
    """)


def downgrade() -> None:
    op.execute("""
        DO $$ BEGIN
            IF EXISTS (SELECT 1 FROM materials)
               OR EXISTS (SELECT 1 FROM project_source_bindings)
               OR EXISTS (SELECT 1 FROM jobs WHERE kind = 'material_parse') THEN
                RAISE EXCEPTION '0008 cannot preserve material originals or source bindings';
            END IF;
        END $$;
    """)
    op.drop_constraint(
        op.f("fk_materials_current_original_id_material_originals"), "materials", type_="foreignkey"
    )
    op.drop_constraint(
        op.f("fk_material_originals_latest_parse_id_material_parse_versions"),
        "material_originals",
        type_="foreignkey",
    )
    op.drop_constraint(
        op.f("fk_project_source_bindings_current_version_id_project_source_binding_versions"),
        "project_source_bindings",
        type_="foreignkey",
    )
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
    op.drop_index(
        op.f("ix_project_source_binding_versions_project_id"),
        table_name="project_source_binding_versions",
    )
    op.drop_table("project_source_binding_versions")
    op.drop_index(
        op.f("ix_material_parse_versions_original_id"), table_name="material_parse_versions"
    )
    op.drop_table("material_parse_versions")
    op.drop_index(op.f("ix_material_originals_material_id"), table_name="material_originals")
    op.drop_table("material_originals")
    op.drop_table("project_source_bindings")
    op.drop_index(op.f("ix_materials_project_id"), table_name="materials")
    op.drop_table("materials")
    op.execute(
        "DROP FUNCTION tp_protect_material_original(); "
        "DROP FUNCTION tp_protect_material_snapshot();"
    )
