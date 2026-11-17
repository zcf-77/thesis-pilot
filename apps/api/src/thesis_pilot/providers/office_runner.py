"""DocsModel → DOCX through the vendored office-wasm, executed by Node in a child process.

The runner script lives in ``apps/api/office-runner/model-to-docx.mjs`` and loads
``apps/web/vendor/muffin-office/office-wasm`` with ``initSync``. A missing Node binary or
runner is an explicit ``OFFICE_RUNNER_UNAVAILABLE`` failure; there is no fallback renderer.
"""

from __future__ import annotations

import base64
import binascii
import json
import shutil
import subprocess
from dataclasses import dataclass
from pathlib import Path

from thesis_pilot.providers.office_server import OfficeServerError

API_ROOT = Path(__file__).resolve().parents[3]
RUNNER = API_ROOT / "office-runner" / "model-to-docx.mjs"
WASM_DIR = API_ROOT.parent / "web" / "vendor" / "muffin-office" / "office-wasm"
MAX_OUTPUT_BYTES = 96 * 1024 * 1024


@dataclass(frozen=True)
class RunnerResult:
    docx: bytes
    engine: str
    unsupported: list[dict[str, object]]


def node_binary() -> str | None:
    from thesis_pilot.core.config import get_settings

    return shutil.which(get_settings().office_node_binary)


def model_to_docx(model: dict[str, object], *, timeout_seconds: int = 120) -> RunnerResult:
    binary = node_binary()
    if binary is None or not RUNNER.is_file() or not (WASM_DIR / "office_wasm_bg.wasm").is_file():
        raise OfficeServerError("OFFICE_RUNNER_UNAVAILABLE")
    try:
        completed = subprocess.run(  # noqa: S603 - fixed binary and script, JSON on stdin
            [binary, str(RUNNER)],
            input=json.dumps({"model": model}, ensure_ascii=False).encode("utf-8"),
            capture_output=True,
            timeout=timeout_seconds,
            check=False,
            env={"PATH": str(Path(binary).parent), "TP_OFFICE_WASM_DIR": str(WASM_DIR)},
        )
    except subprocess.TimeoutExpired:
        raise OfficeServerError("OFFICE_TIMEOUT") from None
    except OSError:
        raise OfficeServerError("OFFICE_RUNNER_UNAVAILABLE") from None
    if completed.returncode != 0 or len(completed.stdout) > MAX_OUTPUT_BYTES * 2:
        raise OfficeServerError("OFFICE_RUNNER_FAILED")
    try:
        reply = json.loads(completed.stdout)
    except ValueError:
        raise OfficeServerError("OFFICE_RUNNER_FAILED") from None
    if not isinstance(reply, dict) or reply.get("ok") is not True:
        code = reply.get("code") if isinstance(reply, dict) else None
        raise OfficeServerError(
            "OFFICE_UNSUPPORTED" if code == "RUNNER_MODEL_REJECTED" else "OFFICE_RUNNER_FAILED"
        )
    try:
        docx = base64.b64decode(str(reply.get("docxBase64", "")), validate=True)
    except (binascii.Error, ValueError):
        raise OfficeServerError("OFFICE_RUNNER_FAILED") from None
    report = reply.get("report")
    unsupported = report.get("unsupported", []) if isinstance(report, dict) else []
    if not docx.startswith(b"PK\x03\x04") or len(docx) > MAX_OUTPUT_BYTES:
        raise OfficeServerError("OFFICE_RUNNER_FAILED")
    return RunnerResult(
        docx=docx,
        engine=str(reply.get("engine", ""))[:40],
        unsupported=[item for item in unsupported if isinstance(item, dict)][:500]
        if isinstance(unsupported, list)
        else [],
    )
