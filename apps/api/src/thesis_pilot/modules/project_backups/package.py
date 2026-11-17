"""``thesispilot-backup/1`` ZIP layout, integrity digests and defensive reading.

Layout::

    manifest.json                 format, schema head, export time, project, per-table columns
                                  and row counts, every file's SHA-256 and the package digest
    data/<table>.jsonl            project rows, one canonical JSON object per line
    refs/<table>.jsonl            referenced instance configuration (flows; config snapshots)
    blobs/<sha256>                binary columns (originals, resources, exported files)

``package_sha256`` is the SHA-256 of the canonical manifest without that key. Because the manifest
lists every other file's SHA-256 and size, it seals the whole package. It detects corruption and
inconsistent edits; it is not a signature against a deliberate re-sealed forgery, so restores
still validate every reference and constraint before writing.
"""

import json
import re
import zipfile
from dataclasses import dataclass
from hashlib import sha256
from io import BytesIO
from typing import cast

from thesis_pilot.core.errors import AppError
from thesis_pilot.modules.project_backups.contracts import (
    MAX_COMPRESSION_RATIO,
    MAX_ENTRIES,
    MAX_ENTRY_BYTES,
    MAX_EXPANDED_BYTES,
    MAX_PACKAGE_BYTES,
    PACKAGE_FORMAT,
)

JsonRow = dict[str, object]
ENTRY_NAME = re.compile(
    r"^(manifest\.json|(data|refs)/[a-z][a-z0-9_]{0,62}\.jsonl|blobs/[0-9a-f]{64})$"
)


class PackageError(AppError):
    """A package that cannot be restored; nothing has been written."""


def package_error(code: str, message: str, status: int = 422) -> PackageError:
    return PackageError("BACKUP_" + code, message, status)


def canonical(value: object) -> bytes:
    return json.dumps(
        value, sort_keys=True, separators=(",", ":"), ensure_ascii=False, allow_nan=False
    ).encode()


def manifest_digest(manifest: dict[str, object]) -> str:
    sealed = {key: value for key, value in manifest.items() if key != "package_sha256"}
    return sha256(canonical(sealed)).hexdigest()


@dataclass(frozen=True)
class Package:
    manifest: dict[str, object]
    data: dict[str, list[JsonRow]]
    refs: dict[str, list[JsonRow]]
    blobs: dict[str, bytes]

    @property
    def package_sha256(self) -> str:
        return cast(str, self.manifest["package_sha256"])

    def columns(self, section: str, table: str) -> list[str]:
        tables = cast(dict[str, dict[str, object]], self.manifest["tables"])
        return cast(list[str], tables[f"{section}/{table}"]["columns"])


def write_package(
    *,
    head: dict[str, object],
    data: dict[str, tuple[list[str], list[JsonRow]]],
    refs: dict[str, tuple[list[str], list[JsonRow]]],
    blobs: dict[str, bytes],
) -> tuple[bytes, dict[str, object]]:
    """Return the ZIP bytes and its manifest. ``head`` holds format/schema/project facts."""
    entries: dict[str, bytes] = {}
    tables: dict[str, dict[str, object]] = {}
    for section, section_tables in (("data", data), ("refs", refs)):
        for table, (columns, rows) in sorted(section_tables.items()):
            lines = [canonical({column: row[column] for column in columns}) for row in rows]
            entries[f"{section}/{table}.jsonl"] = b"".join(line + b"\n" for line in lines)
            tables[f"{section}/{table}"] = {"columns": columns, "rows": len(rows)}
    for digest, blob in sorted(blobs.items()):
        entries[f"blobs/{digest}"] = blob
    manifest: dict[str, object] = {
        **head,
        "format": PACKAGE_FORMAT,
        "tables": tables,
        "files": [
            {"path": path, "sha256": sha256(content).hexdigest(), "bytes": len(content)}
            for path, content in sorted(entries.items())
        ],
    }
    manifest["package_sha256"] = manifest_digest(manifest)
    buffer = BytesIO()
    with zipfile.ZipFile(buffer, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=6) as zf:
        zf.writestr("manifest.json", canonical(manifest))
        for path, body in sorted(entries.items()):
            zf.writestr(path, body)
    return buffer.getvalue(), manifest


def _read_entries(data: bytes) -> dict[str, bytes]:
    if not 1 <= len(data) <= MAX_PACKAGE_BYTES:
        raise package_error("PACKAGE_TOO_LARGE", "备份文件超过 256MiB 上限或为空。", 413)
    try:
        archive = zipfile.ZipFile(BytesIO(data))
    except (zipfile.BadZipFile, ValueError, OSError):
        raise package_error("PACKAGE_INVALID", "文件不是有效的项目备份包。") from None
    with archive:
        infos = archive.infolist()
        if not infos or len(infos) > MAX_ENTRIES:
            raise package_error("PACKAGE_INVALID", "备份包文件数量不在允许范围内。")
        names = [info.filename for info in infos]
        if len(set(names)) != len(names):
            raise package_error("PACKAGE_UNSAFE", "备份包含有重复路径，已拒绝。")
        expanded = 0
        for info in infos:
            if not ENTRY_NAME.fullmatch(info.filename):
                raise package_error("PACKAGE_UNSAFE", "备份包含有不允许的路径，已拒绝。")
            if info.flag_bits & 0x1 or info.compress_type not in (
                zipfile.ZIP_STORED,
                zipfile.ZIP_DEFLATED,
            ):
                raise package_error("PACKAGE_INVALID", "备份包使用了不支持的加密或压缩方式。")
            expanded += info.file_size
            if info.file_size > MAX_ENTRY_BYTES or expanded > MAX_EXPANDED_BYTES:
                raise package_error("PACKAGE_UNSAFE", "备份包解压后超过大小上限，已拒绝。", 413)
            if info.file_size > 1024 * 1024 and info.file_size > MAX_COMPRESSION_RATIO * max(
                info.compress_size, 1
            ):
                raise package_error("PACKAGE_UNSAFE", "备份包压缩比异常，已拒绝。", 413)
        entries: dict[str, bytes] = {}
        for info in infos:
            try:
                with archive.open(info) as handle:
                    content = handle.read(info.file_size + 1)
            except (zipfile.BadZipFile, OSError, EOFError, ValueError):
                raise package_error("PACKAGE_CORRUPT", "备份包内容损坏，校验失败。") from None
            if len(content) != info.file_size:
                raise package_error("PACKAGE_CORRUPT", "备份包内容长度与目录不一致。")
            entries[info.filename] = content
    return entries


def _json(content: bytes) -> object:
    def reject_constant(value: str) -> object:
        raise ValueError(value)

    return json.loads(content.decode("utf-8"), parse_constant=reject_constant)


def read_package(data: bytes) -> Package:
    """Structural and integrity checks only; schema and reference checks happen on restore."""
    entries = _read_entries(data)
    raw = entries.pop("manifest.json", None)
    if raw is None:
        raise package_error("PACKAGE_INVALID", "备份包缺少清单文件。")
    try:
        manifest = _json(raw)
    except (UnicodeDecodeError, ValueError):
        raise package_error("PACKAGE_INVALID", "备份清单不是有效的 JSON。") from None
    if not isinstance(manifest, dict):
        raise package_error("PACKAGE_INVALID", "备份清单结构无效。")
    if manifest.get("format") != PACKAGE_FORMAT:
        raise package_error(
            "FORMAT_UNSUPPORTED", "备份格式版本不受支持，请使用本系统导出的项目备份。"
        )
    files = manifest.get("files")
    tables = manifest.get("tables")
    if (
        not isinstance(files, list)
        or not isinstance(tables, dict)
        or not isinstance(manifest.get("package_sha256"), str)
        or not isinstance(manifest.get("schema_head"), str)
        or not isinstance(manifest.get("exported_at"), str)
        or not isinstance(manifest.get("project"), dict)
    ):
        raise package_error("PACKAGE_INVALID", "备份清单缺少必要字段。")
    if manifest_digest(manifest) != manifest["package_sha256"]:
        raise package_error("PACKAGE_CORRUPT", "备份清单摘要不一致，文件可能已被修改或损坏。")
    listed: dict[str, dict[str, object]] = {}
    for item in files:
        if not isinstance(item, dict) or not isinstance(item.get("path"), str):
            raise package_error("PACKAGE_INVALID", "备份清单的文件列表无效。")
        listed[cast(str, item["path"])] = item
    if set(listed) != set(entries):
        raise package_error("PACKAGE_CORRUPT", "备份包文件与清单不一致。")
    for path, content in entries.items():
        item = listed[path]
        if item.get("bytes") != len(content) or item.get("sha256") != sha256(content).hexdigest():
            raise package_error("PACKAGE_CORRUPT", "备份包内文件摘要不一致，文件可能已损坏。")
    package_data: dict[str, list[JsonRow]] = {}
    package_refs: dict[str, list[JsonRow]] = {}
    blobs: dict[str, bytes] = {}
    for path, content in entries.items():
        if path.startswith("blobs/"):
            digest = path.removeprefix("blobs/")
            if sha256(content).hexdigest() != digest:
                raise package_error("PACKAGE_CORRUPT", "备份包内原件摘要不一致。")
            blobs[digest] = content
            continue
        key = path.removesuffix(".jsonl")
        spec = tables.get(key)
        if not isinstance(spec, dict):
            raise package_error("PACKAGE_INVALID", "备份包含有清单未声明的数据表。")
        columns = spec.get("columns")
        if (
            not isinstance(columns, list)
            or not all(isinstance(column, str) for column in columns)
            or len(set(columns)) != len(columns)
        ):
            raise package_error("PACKAGE_INVALID", "备份清单的字段列表无效。")
        rows: list[JsonRow] = []
        for line in content.split(b"\n"):
            if not line:
                continue
            try:
                row = _json(line)
            except (UnicodeDecodeError, ValueError):
                raise package_error("PACKAGE_INVALID", "备份数据行不是有效的 JSON。") from None
            if not isinstance(row, dict) or set(row) != set(columns):
                raise package_error("PACKAGE_INVALID", "备份数据行与声明字段不一致。")
            rows.append(row)
        if spec.get("rows") != len(rows) or (content and not content.endswith(b"\n")):
            raise package_error("PACKAGE_CORRUPT", "备份数据行数与清单不一致。")
        section, table = key.split("/", 1)
        (package_data if section == "data" else package_refs)[table] = rows
    declared = {key for key in tables}
    present = {f"data/{name}" for name in package_data} | {f"refs/{name}" for name in package_refs}
    if declared != present:
        raise package_error("PACKAGE_INVALID", "备份清单声明的数据表缺失。")
    return Package(manifest, package_data, package_refs, blobs)
