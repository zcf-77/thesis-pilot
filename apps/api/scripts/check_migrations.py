"""Enforce one migration head and keep readiness aligned with the schema contract."""

from alembic.config import Config
from alembic.script import ScriptDirectory

from thesis_pilot.api.health import SCHEMA_REVISION

heads = ScriptDirectory.from_config(Config("alembic.ini")).get_heads()
if heads != [SCHEMA_REVISION]:
    raise SystemExit(f"Expected exactly one migration head {SCHEMA_REVISION}; found {heads}")
print(f"Migration head verified: {SCHEMA_REVISION}")
