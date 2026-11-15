"""Export an actual generated contract; never hand-maintain an imagined schema."""

import argparse
import json
from pathlib import Path

from thesis_pilot.core.config import Settings
from thesis_pilot.main import create_app

parser = argparse.ArgumentParser()
parser.add_argument("--check", action="store_true")
args = parser.parse_args()
target = Path(__file__).resolve().parents[1] / "openapi.json"
# Ignore workstation secrets and production docs suppression when generating contracts.
schema = create_app(
    Settings(
        _env_file=None,
        environment="test",
        database_url="sqlite://",
        api_token="",
        auth_mode="workspace",
        workspace_origin="http://127.0.0.1:8017",
        workspace_access_key="openapi-fixture-not-a-credential-0000",
        workspace_web_root=None,
        redis_url="redis://127.0.0.1:6379/0",
        cors_origins=[],
        worker_lease_seconds=60,
    )
).openapi()
content = json.dumps(schema, ensure_ascii=False, indent=2, sort_keys=True) + "\n"
if args.check:
    if not target.exists() or target.read_text(encoding="utf-8") != content:
        raise SystemExit(
            "OpenAPI baseline missing or stale; run scripts/export_openapi.py and review."
        )
else:
    target.write_text(content, encoding="utf-8")
print("OpenAPI contract verified" if args.check else "OpenAPI contract exported")
