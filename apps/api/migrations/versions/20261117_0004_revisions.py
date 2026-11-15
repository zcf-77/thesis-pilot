"""Persist protected candidates and immutable revision command receipts.

Revision ID: 20261117_0004
Revises: 20261117_0003
"""

import sqlalchemy as sa
from alembic import op

revision = "20261117_0004"
down_revision = "20261117_0003"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.drop_constraint(
        op.f("ck_document_versions_source_supported"), "document_versions", type_="check"
    )
    op.create_check_constraint(
        op.f("ck_document_versions_source_supported"),
        "document_versions",
        "source IN ('local_import', 'manual_edit', 'ai_adoption', "
        "'adoption_undo', 'version_revert')",
    )
    op.create_table(
        "revision_candidates",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("document_id", sa.Uuid(), nullable=False),
        sa.Column("base_version", sa.BigInteger(), nullable=False),
        sa.Column("input_json", sa.JSON(), nullable=False),
        sa.Column("policy_version", sa.String(64), nullable=False),
        sa.Column("policy_digest", sa.String(64), nullable=False),
        sa.Column("generation_token", sa.Uuid(), nullable=False),
        sa.Column("producer", sa.String(32), nullable=False),
        sa.Column("status", sa.String(16), nullable=False),
        sa.Column("revision", sa.BigInteger(), nullable=False),
        sa.Column("decisions_json", sa.JSON(), nullable=False),
        sa.Column("result_version", sa.BigInteger(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("id", name="pk_revision_candidates"),
        sa.UniqueConstraint("document_id", "id", name="uq_revision_candidates_document_id_id"),
        sa.ForeignKeyConstraint(
            ["document_id"],
            ["documents.id"],
            name="fk_revision_candidates_document_id_documents",
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["document_id", "base_version"],
            ["document_versions.document_id", "document_versions.version"],
            name="fk_revision_candidates_base_version",
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["document_id", "result_version"],
            ["document_versions.document_id", "document_versions.version"],
            name="fk_revision_candidates_result_version",
            ondelete="RESTRICT",
        ),
        sa.CheckConstraint("revision BETWEEN 1 AND 9007199254740991", name="revision_range"),
        sa.CheckConstraint(
            "status IN ('generating', 'ready', 'invalid', 'cancelled', 'applied', 'undone')",
            name="status_supported",
        ),
        sa.CheckConstraint("producer = 'deterministic_preview'", name="producer_supported"),
    )
    op.create_index(
        "ix_revision_candidates_document_created",
        "revision_candidates",
        ["document_id", "created_at", "id"],
    )
    op.create_table(
        "revision_proposals",
        sa.Column("candidate_id", sa.Uuid(), nullable=False),
        sa.Column("patches_json", sa.JSON(), nullable=False),
        sa.Column("checks_json", sa.JSON(), nullable=False),
        sa.Column("digest", sa.String(64), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("candidate_id", name="pk_revision_proposals"),
        sa.ForeignKeyConstraint(
            ["candidate_id"],
            ["revision_candidates.id"],
            name="fk_revision_proposals_candidate_id_revision_candidates",
            ondelete="RESTRICT",
        ),
    )
    op.create_table(
        "revision_commands",
        sa.Column("document_id", sa.Uuid(), nullable=False),
        sa.Column("command_id", sa.Uuid(), nullable=False),
        sa.Column("operation", sa.String(16), nullable=False),
        sa.Column("request_hash", sa.String(64), nullable=False),
        sa.Column("request_json", sa.JSON(), nullable=False),
        sa.Column("candidate_id", sa.Uuid(), nullable=True),
        sa.Column("candidate_revision", sa.BigInteger(), nullable=True),
        sa.Column("base_version", sa.BigInteger(), nullable=True),
        sa.Column("result_version", sa.BigInteger(), nullable=True),
        sa.Column("reverses_command_id", sa.Uuid(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("document_id", "command_id", name="pk_revision_commands"),
        sa.ForeignKeyConstraint(
            ["document_id"],
            ["documents.id"],
            name="fk_revision_commands_document_id_documents",
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["document_id", "candidate_id"],
            ["revision_candidates.document_id", "revision_candidates.id"],
            name="fk_revision_commands_candidate",
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["document_id", "base_version"],
            ["document_versions.document_id", "document_versions.version"],
            name="fk_revision_commands_base_version",
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["document_id", "result_version"],
            ["document_versions.document_id", "document_versions.version"],
            name="fk_revision_commands_result_version",
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["document_id", "reverses_command_id"],
            ["revision_commands.document_id", "revision_commands.command_id"],
            name="fk_revision_commands_reverses",
            ondelete="RESTRICT",
        ),
        sa.UniqueConstraint(
            "document_id", "reverses_command_id", name="uq_revision_commands_reversal"
        ),
        sa.CheckConstraint(
            "operation IN ('create', 'proposal', 'decide', 'apply', 'cancel', 'undo', 'revert')",
            name="operation_supported",
        ),
        sa.CheckConstraint(
            "candidate_revision IS NULL OR candidate_revision BETWEEN 1 AND 9007199254740991",
            name="candidate_revision_range",
        ),
        sa.CheckConstraint(
            "(operation = 'undo') = (reverses_command_id IS NOT NULL)", name="undo_reference"
        ),
    )
    op.create_index(
        "ix_revision_commands_candidate_operation",
        "revision_commands",
        ["candidate_id", "operation"],
    )
    op.execute("""
        CREATE FUNCTION thesis_pilot_immutable_revision_fact() RETURNS trigger
        LANGUAGE plpgsql AS $$
        BEGIN
            RAISE EXCEPTION 'Revision facts are immutable' USING ERRCODE = '23514';
        END;
        $$
    """)
    for table in ("revision_proposals", "revision_commands"):
        op.execute(f"""
            CREATE TRIGGER {table}_immutable BEFORE UPDATE OR DELETE ON {table}
            FOR EACH ROW EXECUTE FUNCTION thesis_pilot_immutable_revision_fact()
        """)
    op.execute("""
        CREATE FUNCTION thesis_pilot_revision_input_fixed() RETURNS trigger
        LANGUAGE plpgsql AS $$
        BEGIN
            IF TG_OP = 'DELETE' THEN
                RAISE EXCEPTION 'Revision candidates cannot be deleted' USING ERRCODE = '23514';
            END IF;
            IF NEW.id IS DISTINCT FROM OLD.id
                OR NEW.document_id IS DISTINCT FROM OLD.document_id
                OR NEW.base_version IS DISTINCT FROM OLD.base_version
                OR NEW.input_json::text IS DISTINCT FROM OLD.input_json::text
                OR NEW.policy_version IS DISTINCT FROM OLD.policy_version
                OR NEW.policy_digest IS DISTINCT FROM OLD.policy_digest
                OR NEW.generation_token IS DISTINCT FROM OLD.generation_token
                OR NEW.producer IS DISTINCT FROM OLD.producer
                OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
                RAISE EXCEPTION 'Revision inputs are immutable' USING ERRCODE = '23514';
            END IF;
            RETURN NEW;
        END;
        $$
    """)
    op.execute("""
        CREATE TRIGGER revision_candidates_input_fixed
        BEFORE UPDATE OR DELETE ON revision_candidates
        FOR EACH ROW EXECUTE FUNCTION thesis_pilot_revision_input_fixed()
    """)


def downgrade() -> None:
    populated = op.get_bind().scalar(
        sa.text("""
        SELECT EXISTS (SELECT 1 FROM revision_candidates)
            OR EXISTS (SELECT 1 FROM revision_commands)
            OR EXISTS (SELECT 1 FROM document_versions
                       WHERE source NOT IN ('local_import', 'manual_edit'))
    """)
    )
    if populated:
        raise RuntimeError("Refusing to remove revision history; use a forward migration")
    op.execute("DROP TRIGGER revision_candidates_input_fixed ON revision_candidates")
    op.execute("DROP FUNCTION thesis_pilot_revision_input_fixed()")
    op.drop_table("revision_commands")
    op.drop_table("revision_proposals")
    op.execute("DROP FUNCTION thesis_pilot_immutable_revision_fact()")
    op.drop_table("revision_candidates")
    op.drop_constraint(
        op.f("ck_document_versions_source_supported"), "document_versions", type_="check"
    )
    op.create_check_constraint(
        op.f("ck_document_versions_source_supported"),
        "document_versions",
        "source IN ('local_import', 'manual_edit')",
    )
