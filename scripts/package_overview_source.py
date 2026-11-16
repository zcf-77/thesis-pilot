"""Build the reviewer source ZIP from a committed application snapshot."""

import argparse
import os
import stat
import subprocess
import tempfile
from pathlib import Path, PurePosixPath
from zipfile import ZipFile

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_OUTPUT = ROOT / "deliverables" / "overview" / "source.zip"
SOURCE_PATHS = (
    ".gitattributes",
    ".gitignore",
    "README.md",
    "apps/api",
    "apps/web",
    ":(exclude)apps/web/public/overview",
    ":(exclude)apps/web/docs/design/screens",
    ":(exclude)apps/web/docs/design/DESIGN-SPEC.pdf",
    ":(exclude)apps/web/docs/design/VERIFICATION.md",
)
BUILD_INPUTS = {
    "apps/api/.env.example",
    "apps/api/alembic.ini",
    "apps/api/migrations/env.py",
    "apps/api/openapi.json",
    "apps/api/pyproject.toml",
    "apps/api/scripts/dev_services.py",
    "apps/api/src/thesis_pilot/main.py",
    "apps/api/uv.lock",
    "apps/web/.env.example",
    "apps/web/docs/design/DESIGN-SPEC.md",
    "apps/web/index.html",
    "apps/web/licenses/README.md",
    "apps/web/package.json",
    "apps/web/pnpm-lock.yaml",
    "apps/web/pnpm-workspace.yaml",
    "apps/web/src/workspace-main.ts",
    "apps/web/vite.config.ts",
}
PRIVATE_DIRECTORIES = {
    ".git", ".mypy_cache", ".pytest_cache", ".ruff_cache", ".venv", "__pycache__",
    "dist", "dist-workspace", "evidence", "node_modules", "private", "test-results", "work",
}
PRIVATE_EXTENSIONS = {".db", ".dump", ".key", ".p12", ".pem", ".sqlite", ".sqlite3", ".zip"}


def verify_source_archive(path: Path) -> int:
    with ZipFile(path) as archive:
        files = [entry for entry in archive.infolist() if not entry.is_dir()]
        names = {entry.filename for entry in files}
        missing = sorted(BUILD_INPUTS - names)
        if missing:
            raise ValueError(f"缺少构建文件：{', '.join(missing)}")

        for entry in files:
            name = PurePosixPath(entry.filename)
            env_file = name.name == ".env" or name.name.startswith(".env.")
            if (
                name.is_absolute()
                or ".." in name.parts
                or stat.S_ISLNK(entry.external_attr >> 16)
                or PRIVATE_DIRECTORIES.intersection(name.parts[:-1])
                or name.suffix.lower() in PRIVATE_EXTENSIONS
                or (env_file and name.name != ".env.example")
            ):
                raise ValueError(f"发现不应分发的路径：{name}")

        damaged = archive.testzip()
        if damaged is not None:
            raise ValueError(f"压缩包校验失败：{damaged}")
        return len(files)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT, help="源码 ZIP 输出路径")
    output = parser.parse_args().output.resolve()
    if output.suffix.lower() != ".zip":
        parser.error("输出文件扩展名必须为 .zip")

    commit = subprocess.check_output(["git", "rev-parse", "--verify", "HEAD"], cwd=ROOT, text=True).strip()
    output.parent.mkdir(parents=True, exist_ok=True)
    descriptor, temporary_name = tempfile.mkstemp(prefix=".source-", suffix=".zip", dir=output.parent)
    os.close(descriptor)
    temporary = Path(temporary_name)
    try:
        subprocess.run(
            ["git", "archive", "--format=zip", f"--output={temporary}", commit, "--", *SOURCE_PATHS],
            cwd=ROOT,
            check=True,
        )
        file_count = verify_source_archive(temporary)
        temporary.replace(output)
    finally:
        temporary.unlink(missing_ok=True)

    print(f"{output} · {file_count} 个文件 · {commit}")


if __name__ == "__main__":
    main()
