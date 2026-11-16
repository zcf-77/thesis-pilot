"""literature

Revision ID: 20261118_0017
Revises: 20261118_0016
"""

import sqlalchemy as sa
from alembic import op

revision = "20261118_0017"
down_revision = "20261118_0016"
branch_labels = None
depends_on = None

# Kinds already allowed at 20261118_0016; literature_search is added on top.
BASE_KINDS = (
    "'diagnostic', 'document_inspection', 'configuration_probe', "
    "'material_parse', 'content_revision', 'document_export', 'change_record', 'review'"
)
BASE_ARTIFACTS = (
    "'document_inspection', 'configuration_probe', 'material_parse', 'content_revision', "
    "'document_export', 'change_record', 'review'"
)


def upgrade() -> None:
    op.create_table(
        "literature_searches",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("project_id", sa.Uuid(), nullable=False),
        sa.Column("job_id", sa.Uuid(), nullable=True),
        sa.Column("source_search_id", sa.Uuid(), nullable=True),
        sa.Column("command_id", sa.Uuid(), nullable=False),
        sa.Column("request_hash", sa.String(length=64), nullable=False),
        sa.Column("query", sa.String(length=300), nullable=False),
        sa.Column("source", sa.String(length=16), nullable=False),
        sa.Column("year_from", sa.Integer(), nullable=True),
        sa.Column("year_to", sa.Integer(), nullable=True),
        sa.Column("row_limit", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint(
            "source IN ('crossref', 'openalex')", name=op.f("ck_literature_searches_source")
        ),
        sa.CheckConstraint(
            "row_limit BETWEEN 1 AND 20", name=op.f("ck_literature_searches_row_limit_bounded")
        ),
        sa.ForeignKeyConstraint(
            ["job_id"],
            ["jobs.id"],
            name=op.f("fk_literature_searches_job_id_jobs"),
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["project_id"],
            ["projects.id"],
            name=op.f("fk_literature_searches_project_id_projects"),
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["source_search_id"],
            ["literature_searches.id"],
            name=op.f("fk_literature_searches_source_search_id_literature_searches"),
            ondelete="RESTRICT",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_literature_searches")),
        sa.UniqueConstraint("command_id", name=op.f("uq_literature_searches_command_id")),
        sa.UniqueConstraint("job_id", name=op.f("uq_literature_searches_job_id")),
    )
    op.create_index(
        op.f("ix_literature_searches_project_id"), "literature_searches", ["project_id"]
    )
    op.create_table(
        "literature_search_snapshots",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("search_id", sa.Uuid(), nullable=False),
        sa.Column("project_id", sa.Uuid(), nullable=False),
        sa.Column("job_id", sa.Uuid(), nullable=False),
        sa.Column("source", sa.String(length=16), nullable=False),
        sa.Column("adapter_version", sa.String(length=64), nullable=False),
        sa.Column("response_sha256", sa.String(length=64), nullable=False),
        sa.Column("total_results", sa.BigInteger(), nullable=False),
        sa.Column("skipped_count", sa.Integer(), nullable=False),
        sa.Column("items", sa.JSON(), nullable=False),
        sa.Column("retrieved_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(
            ["job_id"],
            ["jobs.id"],
            name=op.f("fk_literature_search_snapshots_job_id_jobs"),
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["project_id"],
            ["projects.id"],
            name=op.f("fk_literature_search_snapshots_project_id_projects"),
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["search_id"],
            ["literature_searches.id"],
            name=op.f("fk_literature_search_snapshots_search_id_literature_searches"),
            ondelete="RESTRICT",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_literature_search_snapshots")),
        sa.UniqueConstraint("job_id", name=op.f("uq_literature_search_snapshots_job_id")),
        sa.UniqueConstraint("search_id", name=op.f("uq_literature_search_snapshots_search_id")),
    )
    op.create_index(
        op.f("ix_literature_search_snapshots_project_id"),
        "literature_search_snapshots",
        ["project_id"],
    )
    op.create_table(
        "literature_entries",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("project_id", sa.Uuid(), nullable=False),
        sa.Column("command_id", sa.Uuid(), nullable=False),
        sa.Column("dedupe_key", sa.String(length=400), nullable=False),
        sa.Column("search_id", sa.Uuid(), nullable=False),
        sa.Column("snapshot_id", sa.Uuid(), nullable=False),
        sa.Column("result_index", sa.Integer(), nullable=False),
        sa.Column("record", sa.JSON(), nullable=False),
        sa.Column("doi", sa.String(length=320), nullable=True),
        sa.Column("title", sa.Text(), nullable=False),
        sa.Column("coverage", sa.String(length=16), nullable=False),
        sa.Column("verification", sa.String(length=16), nullable=False),
        sa.Column("verification_detail", sa.JSON(), nullable=False),
        sa.Column("verified_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("removed", sa.Boolean(), nullable=False),
        sa.Column("version", sa.BigInteger(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint(
            "coverage IN ('biblio', 'abstract')", name=op.f("ck_literature_entries_coverage")
        ),
        sa.CheckConstraint(
            "verification IN ('verified', 'conflict', 'not_found', 'unverified')",
            name=op.f("ck_literature_entries_verification"),
        ),
        sa.CheckConstraint("version >= 1", name=op.f("ck_literature_entries_version_positive")),
        sa.ForeignKeyConstraint(
            ["project_id"],
            ["projects.id"],
            name=op.f("fk_literature_entries_project_id_projects"),
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["search_id"],
            ["literature_searches.id"],
            name=op.f("fk_literature_entries_search_id_literature_searches"),
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["snapshot_id"],
            ["literature_search_snapshots.id"],
            name=op.f("fk_literature_entries_snapshot_id_literature_search_snapshots"),
            ondelete="RESTRICT",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_literature_entries")),
        sa.UniqueConstraint("command_id", name=op.f("uq_literature_entries_command_id")),
        sa.UniqueConstraint("project_id", "dedupe_key", name="uq_literature_entries_dedupe"),
    )
    op.create_index(op.f("ix_literature_entries_project_id"), "literature_entries", ["project_id"])
    op.create_table(
        "literature_entry_versions",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("entry_id", sa.Uuid(), nullable=False),
        sa.Column("project_id", sa.Uuid(), nullable=False),
        sa.Column("version", sa.BigInteger(), nullable=False),
        sa.Column("action", sa.String(length=16), nullable=False),
        sa.Column("removed", sa.Boolean(), nullable=False),
        sa.Column("verification", sa.String(length=16), nullable=False),
        sa.Column("verification_detail", sa.JSON(), nullable=False),
        sa.Column("command_id", sa.Uuid(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint(
            "action IN ('saved', 'verified', 'removed', 'restored')",
            name=op.f("ck_literature_entry_versions_action"),
        ),
        sa.ForeignKeyConstraint(
            ["entry_id"],
            ["literature_entries.id"],
            name=op.f("fk_literature_entry_versions_entry_id_literature_entries"),
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["project_id"],
            ["projects.id"],
            name=op.f("fk_literature_entry_versions_project_id_projects"),
            ondelete="RESTRICT",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_literature_entry_versions")),
        sa.UniqueConstraint("command_id", name=op.f("uq_literature_entry_versions_command_id")),
        sa.UniqueConstraint("entry_id", "version", name="uq_literature_entry_versions_version"),
    )
    op.create_index(
        op.f("ix_literature_entry_versions_entry_id"), "literature_entry_versions", ["entry_id"]
    )
    op.create_index(
        op.f("ix_literature_entry_versions_project_id"),
        "literature_entry_versions",
        ["project_id"],
    )
    _job_kinds(True)
    op.execute("""
        CREATE FUNCTION tp_literature_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN
            RAISE EXCEPTION 'Literature snapshots and history are immutable'
                USING ERRCODE = '23514';
        END $$;
        CREATE TRIGGER literature_search_snapshots_immutable
            BEFORE UPDATE OR DELETE ON literature_search_snapshots
            FOR EACH ROW EXECUTE FUNCTION tp_literature_immutable();
        CREATE TRIGGER literature_entry_versions_immutable
            BEFORE UPDATE OR DELETE ON literature_entry_versions
            FOR EACH ROW EXECUTE FUNCTION tp_literature_immutable();
        CREATE FUNCTION tp_literature_search_fixed() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN
            IF TG_OP = 'DELETE' THEN
                RAISE EXCEPTION 'Literature searches cannot be deleted' USING ERRCODE = '23514';
            END IF;
            IF ROW(NEW.id, NEW.project_id, NEW.source_search_id, NEW.command_id,
                   NEW.request_hash, NEW.query, NEW.source, NEW.year_from, NEW.year_to,
                   NEW.row_limit, NEW.created_at)
               IS DISTINCT FROM
               ROW(OLD.id, OLD.project_id, OLD.source_search_id, OLD.command_id,
                   OLD.request_hash, OLD.query, OLD.source, OLD.year_from, OLD.year_to,
                   OLD.row_limit, OLD.created_at)
               OR (OLD.job_id IS NOT NULL AND NEW.job_id IS DISTINCT FROM OLD.job_id) THEN
                RAISE EXCEPTION 'Literature search inputs are immutable' USING ERRCODE = '23514';
            END IF;
            RETURN NEW;
        END $$;
        CREATE TRIGGER literature_searches_fixed BEFORE UPDATE OR DELETE ON literature_searches
            FOR EACH ROW EXECUTE FUNCTION tp_literature_search_fixed();
        CREATE FUNCTION tp_literature_entry_source_fixed() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN
            IF TG_OP = 'DELETE' THEN
                RAISE EXCEPTION 'Literature entries are removed, never deleted'
                    USING ERRCODE = '23514';
            END IF;
            IF ROW(NEW.id, NEW.project_id, NEW.command_id, NEW.dedupe_key, NEW.search_id,
                   NEW.snapshot_id, NEW.result_index, NEW.record::text, NEW.doi, NEW.title,
                   NEW.coverage, NEW.created_at)
               IS DISTINCT FROM
               ROW(OLD.id, OLD.project_id, OLD.command_id, OLD.dedupe_key, OLD.search_id,
                   OLD.snapshot_id, OLD.result_index, OLD.record::text, OLD.doi, OLD.title,
                   OLD.coverage, OLD.created_at)
               OR NEW.version <> OLD.version + 1 THEN
                RAISE EXCEPTION 'Literature entry source fields are immutable'
                    USING ERRCODE = '23514';
            END IF;
            RETURN NEW;
        END $$;
        CREATE TRIGGER literature_entries_source_fixed
            BEFORE UPDATE OR DELETE ON literature_entries
            FOR EACH ROW EXECUTE FUNCTION tp_literature_entry_source_fixed();
    """)


def downgrade() -> None:
    op.execute("""
        DO $$ BEGIN
            IF EXISTS (SELECT 1 FROM literature_searches)
               OR EXISTS (SELECT 1 FROM jobs WHERE kind = 'literature_search') THEN
                RAISE EXCEPTION '0016 cannot preserve literature history';
            END IF;
        END $$;
    """)
    _job_kinds(False)
    for table in (
        "literature_entry_versions",
        "literature_entries",
        "literature_search_snapshots",
        "literature_searches",
    ):
        op.drop_table(table)
    op.execute(
        "DROP FUNCTION tp_literature_immutable(); DROP FUNCTION tp_literature_search_fixed(); "
        "DROP FUNCTION tp_literature_entry_source_fixed();"
    )


def _job_kinds(include_literature: bool) -> None:
    suffix = ", 'literature_search'" if include_literature else ""
    for table, name, kinds in (
        ("jobs", "ck_jobs_job_kind", BASE_KINDS),
        ("job_artifacts", "ck_job_artifacts_job_artifact_kind", BASE_ARTIFACTS),
    ):
        op.drop_constraint(op.f(name), table, type_="check")
        op.create_check_constraint(op.f(name), table, f"kind IN ({kinds}{suffix})")
