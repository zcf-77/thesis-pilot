"""One local/CI entry point. Missing dependencies or services are failures, not skips."""

import argparse
import os
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def run(*args: str) -> None:
    print("CHECK:", " ".join(args), flush=True)
    subprocess.run(args, cwd=ROOT, check=True)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--integration", action="store_true")
    args = parser.parse_args()
    if not (ROOT / "uv.lock").is_file():
        raise SystemExit("Missing uv.lock: run uv lock and uv sync on an authorized network first.")
    run("uv", "lock", "--check", "--offline")
    run(sys.executable, "-m", "ruff", "check", ".")
    run(sys.executable, "-m", "ruff", "format", "--check", ".")
    run(sys.executable, "-m", "mypy")
    run(sys.executable, "-m", "pytest", "--ignore=tests/integration")
    run(sys.executable, "scripts/export_openapi.py", "--check")
    run(sys.executable, "scripts/check_migrations.py")
    if args.integration:
        for name in ("TP_TEST_DATABASE_URL", "TP_TEST_REDIS_URL"):
            if not os.environ.get(name):
                raise SystemExit(f"{name} is required for explicit integration tests; no skip.")
        run(sys.executable, "-m", "pytest", "tests/integration")


if __name__ == "__main__":
    main()
