"""Bound each worker attempt independently of its renewable lease.

Revision ID: 20261117_0002
Revises: 20261114_0001
"""

import sqlalchemy as sa
from alembic import op

revision = "20261117_0002"
down_revision = "20261114_0001"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "jobs", sa.Column("execution_deadline_at", sa.DateTime(timezone=True), nullable=True)
    )


def downgrade() -> None:
    op.drop_column("jobs", "execution_deadline_at")
