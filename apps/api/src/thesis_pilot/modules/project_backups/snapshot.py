"""Read a project's complete object graph into a package, and restore a package as a new project.

Both directions are generic over ``registry.PROJECT_TABLES`` and the SQLAlchemy metadata, so a
newly registered table is exported, validated (scope, primary keys, foreign-key closure), remapped
and inserted without table-specific code. Table-specific behaviour is limited to the documented
fix-ups at the end of :func:`restore_package`.
"""

import re
from collections import defaultdict, deque
from collections.abc import Iterable
from dataclasses import dataclass
from datetime import UTC, date, datetime
from hashlib import sha256
from typing import Any, cast
from uuid import UUID, uuid4

from sqlalchemy import (
    JSON,
    BigInteger,
    Boolean,
    ColumnElement,
    Date,
    DateTime,
    Integer,
    LargeBinary,
    String,
    Table,
    Text,
    Uuid,
    and_,
    insert,
    select,
    update,
)
from sqlalchemy.orm import Session

from thesis_pilot.modules.project_backups.package import JsonRow, Package, package_error
from thesis_pilot.modules.project_backups.registry import (
    PROJECT_TABLES,
    REFERENCE_TABLES,
    SPECS,
    TableSpec,
    tables,
)

RESTORED_SUFFIX = "（恢复副本）"
INTERRUPTED_CODE = "BACKUP_RESTORE_INTERRUPTED"
UUID_TEXT = re.compile(r"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}")
SUPPORTED_TYPES = (
    Uuid,
    String,
    Text,
    Integer,
    BigInteger,
    Boolean,
    DateTime,
    Date,
    JSON,
    LargeBinary,
)


# ---------------------------------------------------------------- value encoding


def _as_utc(value: datetime) -> datetime:
    return value.replace(tzinfo=UTC) if value.tzinfo is None else value.astimezone(UTC)


def encode_value(column_type: object, value: object, blobs: dict[str, bytes]) -> object:
    if value is None:
        return None
    if isinstance(column_type, LargeBinary):
        data = bytes(cast(bytes, value))
        digest = sha256(data).hexdigest()
        blobs[digest] = data
        return {"$blob": digest}
    if isinstance(column_type, Uuid):
        return str(value)
    if isinstance(column_type, DateTime):
        return _as_utc(cast(datetime, value)).isoformat()
    if isinstance(column_type, Date):
        return cast(date, value).isoformat()
    return value


def _invalid(table: str, column: str) -> Exception:
    return package_error("PACKAGE_INVALID", f"备份数据字段无效：{table}.{column}。")


def decode_value(table: Table, column: str, value: object, blobs: dict[str, bytes]) -> object:
    column_type = table.c[column].type
    name = table.name
    if value is None:
        return None
    try:
        if isinstance(column_type, LargeBinary):
            if not isinstance(value, dict) or set(value) != {"$blob"}:
                raise ValueError
            digest = value["$blob"]
            if not isinstance(digest, str) or digest not in blobs:
                raise package_error("REFERENCE_MISSING", f"备份缺少原件：{name}.{column}。")
            return blobs[digest]
        if isinstance(column_type, Uuid):
            if not isinstance(value, str):
                raise ValueError
            return UUID(value)
        if isinstance(column_type, DateTime):
            if not isinstance(value, str):
                raise ValueError
            return _as_utc(datetime.fromisoformat(value))
        if isinstance(column_type, Date):
            if not isinstance(value, str):
                raise ValueError
            return date.fromisoformat(value)
        if isinstance(column_type, Boolean):
            if not isinstance(value, bool):
                raise ValueError
            return value
        if isinstance(column_type, Integer):
            if not isinstance(value, int) or isinstance(value, bool):
                raise ValueError
            return value
        if isinstance(column_type, String):
            length = column_type.length
            if not isinstance(value, str) or (length is not None and len(value) > length):
                raise ValueError
            return value
        if isinstance(column_type, JSON):
            return value
    except ValueError:
        raise _invalid(name, column) from None
    raise _invalid(name, column)


# ---------------------------------------------------------------- export


def scope_condition(spec: TableSpec, project_id: UUID) -> ColumnElement[bool]:
    metadata = tables()
    table = metadata[spec.table]
    conditions: list[ColumnElement[bool]] = []
    if spec.scope.parent is None:
        conditions.append(table.c[spec.scope.column] == project_id)
    else:
        parent_spec = SPECS[spec.scope.parent]
        parent = metadata[parent_spec.table]
        conditions.append(
            table.c[spec.scope.column].in_(
                select(parent.c[spec.scope.parent_column]).where(
                    scope_condition(parent_spec, project_id)
                )
            )
        )
    if spec.excluded_kinds:
        conditions.append(table.c["kind"].not_in(spec.excluded_kinds))
    return and_(*conditions)


@dataclass(frozen=True)
class Collected:
    project_name: str
    data: dict[str, tuple[list[str], list[JsonRow]]]
    refs: dict[str, tuple[list[str], list[JsonRow]]]
    blobs: dict[str, bytes]

    @property
    def counts(self) -> dict[str, int]:
        return {table: len(rows) for table, (_, rows) in self.data.items()}


def _rows(
    session: Session, table: Table, where: ColumnElement[bool], blobs: dict[str, bytes]
) -> list[JsonRow]:
    ordered = select(table).where(where).order_by(*table.primary_key.columns)
    result: list[JsonRow] = []
    for row in session.execute(ordered).mappings():
        result.append(
            {
                column.name: encode_value(column.type, row[column.name], blobs)
                for column in table.columns
            }
        )
    return result


def collect_project(session: Session, project_id: UUID) -> Collected:
    """Read every registered object of one project. Call inside one snapshot transaction."""
    metadata = tables()
    blobs: dict[str, bytes] = {}
    data: dict[str, tuple[list[str], list[JsonRow]]] = {}
    for spec in PROJECT_TABLES:
        table = metadata[spec.table]
        columns = [column.name for column in table.columns]
        data[spec.table] = (
            columns,
            _rows(session, table, scope_condition(spec, project_id), blobs),
        )
    project_rows = data["projects"][1]
    if len(project_rows) != 1:
        raise package_error("PROJECT_MISSING", "项目不存在，无法备份。", 404)
    refs: dict[str, tuple[list[str], list[JsonRow]]] = {}
    # Flow versions referenced by project rows, and their flows.
    version_ids: set[UUID] = set()
    for spec in PROJECT_TABLES:
        table = metadata[spec.table]
        for constraint in table.foreign_key_constraints:
            if constraint.referred_table.name != "project_flow_versions":
                continue
            (column,) = constraint.column_keys
            version_ids.update(
                UUID(cast(str, row[column]))
                for row in data[spec.table][1]
                if row[column] is not None
            )
    flow_versions = metadata["project_flow_versions"]
    version_rows = _rows(session, flow_versions, flow_versions.c.id.in_(version_ids), blobs)
    flows = metadata["project_flows"]
    flow_ids = {UUID(cast(str, row["flow_id"])) for row in version_rows}
    refs["project_flow_versions"] = ([c.name for c in flow_versions.columns], version_rows)
    refs["project_flows"] = (
        [c.name for c in flows.columns],
        _rows(session, flows, flows.c.id.in_(flow_ids), blobs),
    )
    # Configuration-library versions named by runs: informational snapshots, never restored.
    config_ids: set[UUID] = set()
    for spec in PROJECT_TABLES:
        for column in spec.external:
            config_ids.update(
                UUID(cast(str, row[column]))
                for row in data[spec.table][1]
                if row[column] is not None
            )
    config_versions = metadata["ai_config_versions"]
    config_rows: list[JsonRow] = []
    seen: set[UUID] = set()
    pending = set(config_ids)
    while pending:
        batch = pending - seen
        seen |= batch
        found = _rows(session, config_versions, config_versions.c.id.in_(batch), blobs)
        config_rows.extend(found)
        # Agent → model/prompt → API versions are referenced from inside the content.
        pending = {
            UUID(match) for row in found for match in UUID_TEXT.findall(str(row["content"]))
        } - seen
    config_rows.sort(key=lambda row: cast(str, row["id"]))
    refs["ai_config_versions"] = ([c.name for c in config_versions.columns], config_rows)
    return Collected(cast(str, project_rows[0]["name"]), data, refs, blobs)


# ---------------------------------------------------------------- restore


@dataclass
class _Row:
    table: str
    values: dict[str, Any]


@dataclass(frozen=True)
class RestoreOutcome:
    project_id: UUID
    source_project_id: UUID
    counts: dict[str, int]
    interrupted_jobs: int


def _check_columns(table: Table, columns: list[str], deferred: Iterable[str] = ()) -> None:
    current = set(table.columns.keys())
    unknown = set(columns) - current
    if unknown:
        raise package_error(
            "SCHEMA_INCOMPATIBLE",
            "备份来自更新或不同的数据结构，当前系统无法安全恢复。",
        )
    for name in current - set(columns):
        column = table.c[name]
        if not column.nullable and column.default is None and column.server_default is None:
            raise package_error(
                "SCHEMA_INCOMPATIBLE", "备份缺少当前数据结构要求的字段，无法安全恢复。"
            )
    for name in deferred:
        if name not in current:
            raise package_error("SCHEMA_INCOMPATIBLE", "备份数据结构与当前系统不一致。")


def _decode(package: Package, section: str, table: Table, rows: list[JsonRow]) -> list[_Row]:
    decoded: list[_Row] = []
    for row in rows:
        values: dict[str, Any] = {}
        for column, raw in row.items():
            value = decode_value(table, column, raw, package.blobs)
            if value is None and not table.c[column].nullable:
                raise _invalid(table.name, column)
            values[column] = value
        decoded.append(_Row(table.name, values))
    return decoded


def _pk(table: Table, values: dict[str, Any]) -> tuple[Any, ...]:
    return tuple(values.get(column.name) for column in table.primary_key.columns)


def _rewrite(value: object, ids: dict[str, str]) -> object:
    if isinstance(value, str):
        return UUID_TEXT.sub(lambda match: ids.get(match.group(0), match.group(0)), value)
    if isinstance(value, list):
        return [_rewrite(item, ids) for item in value]
    if isinstance(value, dict):
        return {key: _rewrite(item, ids) for key, item in value.items()}
    return value


def _fk_columns(table: Table) -> dict[str, str]:
    """Single-column FK target table by local column (composite FKs counted per column)."""
    result: dict[str, str] = {}
    for constraint in table.foreign_key_constraints:
        for column in constraint.column_keys:
            result.setdefault(column, constraint.referred_table.name)
    return result


def _resolve_flows(
    session: Session, package: Package, now: datetime, ids: dict[UUID, UUID]
) -> None:
    """Reuse identical flow versions on this instance; otherwise copy them as a disabled flow."""
    metadata = tables()
    flows_table = metadata["project_flows"]
    versions_table = metadata["project_flow_versions"]
    for name, table in (("project_flows", flows_table), ("project_flow_versions", versions_table)):
        if name in package.refs:
            _check_columns(table, package.columns("refs", name))
    flows = {
        row.values["id"]: row
        for row in _decode(package, "refs", flows_table, package.refs.get("project_flows", []))
    }
    versions = _decode(
        package, "refs", versions_table, package.refs.get("project_flow_versions", [])
    )
    missing: dict[UUID, list[_Row]] = defaultdict(list)
    for row in versions:
        existing = (
            session.execute(select(versions_table).where(versions_table.c.id == row.values["id"]))
            .mappings()
            .first()
        )
        same = existing is not None and all(
            existing[key] == row.values[key] for key in ("flow_id", "version", "name", "stages")
        )
        if same:
            continue
        if row.values["flow_id"] not in flows:
            raise package_error("REFERENCE_MISSING", "备份缺少所引用的流程定义。")
        missing[row.values["flow_id"]].append(row)
    for flow_id, rows in missing.items():
        source = flows[flow_id].values
        new_flow = uuid4()
        ids[flow_id] = new_flow
        session.execute(
            insert(flows_table).values(
                id=new_flow,
                name=source["name"],
                version=max(row.values["version"] for row in rows),
                enabled=False,
                created_at=now,
                updated_at=now,
            )
        )
        for row in sorted(rows, key=lambda item: item.values["version"]):
            new_version = uuid4()
            ids[row.values["id"]] = new_version
            session.execute(
                insert(versions_table).values(
                    id=new_version,
                    flow_id=new_flow,
                    version=row.values["version"],
                    name=row.values["name"],
                    stages=row.values["stages"],
                    created_at=row.values["created_at"],
                )
            )


@dataclass
class Prepared:
    """A fully validated package, ready to insert. Single use: inserting rewrites the rows."""

    package: Package
    nodes: list[_Row]
    order: list[int]
    counts: dict[str, int]
    source_project_id: UUID


def prepare_restore(package: Package) -> Prepared:
    """Schema compatibility, scope, identities, binary integrity and reference closure.

    Pure: reads no database state, so an upload can be rejected before anything is stored.
    """
    metadata = tables()
    project_meta = package.manifest.get("project")
    if not isinstance(project_meta, dict) or not isinstance(project_meta.get("id"), str):
        raise package_error("PACKAGE_INVALID", "备份清单缺少项目信息。")
    unknown = set(package.data) - set(SPECS)
    if unknown:
        raise package_error(
            "SCHEMA_INCOMPATIBLE", "备份包含当前系统不认识的对象类型，无法安全恢复。"
        )
    for name in set(package.refs) - {*REFERENCE_TABLES, "ai_config_versions"}:
        raise package_error("SCHEMA_INCOMPATIBLE", f"备份包含当前系统不认识的引用：{name}。")

    rows_by_table: dict[str, list[_Row]] = {}
    for spec in PROJECT_TABLES:
        table = metadata[spec.table]
        raw = package.data.get(spec.table)
        if raw is None:
            rows_by_table[spec.table] = []
            continue
        _check_columns(table, package.columns("data", spec.table), spec.deferred)
        rows_by_table[spec.table] = _decode(package, "data", table, raw)

    projects = rows_by_table["projects"]
    if len(projects) != 1 or str(projects[0].values["id"]) != project_meta["id"]:
        raise package_error("PACKAGE_INVALID", "备份必须恰好包含清单所述的一个项目。")
    source_project_id = cast(UUID, projects[0].values["id"])

    # Primary keys are unique and every row belongs to the packaged project.
    keys: dict[str, set[tuple[Any, ...]]] = {}
    for spec in PROJECT_TABLES:
        table = metadata[spec.table]
        seen: set[tuple[Any, ...]] = set()
        for row in rows_by_table[spec.table]:
            key = _pk(table, row.values)
            if key in seen:
                raise package_error("PACKAGE_INVALID", f"备份中 {spec.table} 存在重复标识。")
            seen.add(key)
            if spec.excluded_kinds and row.values.get("kind") in spec.excluded_kinds:
                raise package_error("PACKAGE_INVALID", "备份不应包含备份或恢复任务本身。")
        keys[spec.table] = seen
    for spec in PROJECT_TABLES:
        scope_value_set: set[Any]
        if spec.scope.parent is None:
            scope_value_set = {source_project_id}
        else:
            parent_rows = rows_by_table[spec.scope.parent]
            scope_value_set = {row.values[spec.scope.parent_column] for row in parent_rows}
        for row in rows_by_table[spec.table]:
            if row.values.get(spec.scope.column) not in scope_value_set:
                raise package_error(
                    "PACKAGE_INVALID", f"备份中 {spec.table} 含有不属于该项目的记录。"
                )

    # Binary integrity: stored digests and sizes match the bytes; no orphan blobs.
    used: set[str] = set()
    for spec in PROJECT_TABLES:
        table = metadata[spec.table]
        binary = [c.name for c in table.columns if isinstance(c.type, LargeBinary)]
        for row in rows_by_table[spec.table]:
            for name in binary:
                data = cast(bytes, row.values[name])
                digest = sha256(data).hexdigest()
                used.add(digest)
                if "sha256" in row.values and row.values["sha256"] != digest:
                    raise package_error("PACKAGE_CORRUPT", "备份中的原件与记录的摘要不一致。")
                if "byte_size" in row.values and row.values["byte_size"] != len(data):
                    raise package_error("PACKAGE_CORRUPT", "备份中的原件与记录的大小不一致。")
    if set(package.blobs) != used:
        raise package_error("PACKAGE_INVALID", "备份包含未被任何记录引用的原件。")

    # Foreign-key closure inside the package (reference tables are resolved below).
    index: dict[tuple[str, tuple[str, ...]], dict[tuple[Any, ...], int]] = {}
    nodes: list[_Row] = [row for spec in PROJECT_TABLES for row in rows_by_table[spec.table]]

    def lookup(target: str, columns: tuple[str, ...]) -> dict[tuple[Any, ...], int]:
        cache = index.get((target, columns))
        if cache is None:
            cache = {}
            for position, node in enumerate(nodes):
                if node.table == target:
                    cache[tuple(node.values[c] for c in columns)] = position
            index[(target, columns)] = cache
        return cache

    reference_versions = {
        row["id"] for row in package.refs.get("project_flow_versions", []) if "id" in row
    }
    edges: dict[int, set[int]] = defaultdict(set)
    indegree = [0] * len(nodes)
    for position, node in enumerate(nodes):
        table = metadata[node.table]
        spec = SPECS[node.table]
        for constraint in table.foreign_key_constraints:
            local = tuple(constraint.column_keys)
            values = tuple(node.values.get(column) for column in local)
            if any(value is None for value in values):
                continue
            target = constraint.referred_table.name
            if target in REFERENCE_TABLES:
                if target == "project_flow_versions" and str(values[0]) not in reference_versions:
                    raise package_error("REFERENCE_MISSING", "备份缺少所引用的流程版本。")
                continue
            remote = tuple(element.column.name for element in constraint.elements)
            found = lookup(target, remote).get(values)
            if found is None:
                raise package_error(
                    "REFERENCE_MISSING", f"备份引用不完整：{node.table} → {target}。"
                )
            if constraint.deferrable or set(local) & set(spec.deferred) or found == position:
                continue
            if position not in edges[found]:
                edges[found].add(position)
                indegree[position] += 1

    # Topological row order (stable: registry order, then package order).
    queue = deque(position for position, degree in enumerate(indegree) if degree == 0)
    order: list[int] = []
    while queue:
        position = queue.popleft()
        order.append(position)
        for child in sorted(edges.get(position, ())):
            indegree[child] -= 1
            if indegree[child] == 0:
                queue.append(child)
    if len(order) != len(nodes):
        raise package_error("PACKAGE_INVALID", "备份中的对象引用形成无法恢复的循环。")
    counts = {spec.table: len(rows_by_table[spec.table]) for spec in PROJECT_TABLES}
    return Prepared(package, nodes, order, counts, source_project_id)


def apply_restore(session: Session, prepared: Prepared, *, now: datetime) -> RestoreOutcome:
    """Insert the prepared package as a new project inside the caller's transaction.

    Any failure raises before commit; the caller's rollback leaves no partial copy.
    """
    metadata = tables()
    package, nodes, order = prepared.package, prepared.nodes, prepared.order
    # Identity map: every UUID in a project row is renewed except configuration references.
    ids: dict[UUID, UUID] = {}
    _resolve_flows(session, package, now, ids)
    for node in nodes:
        table = metadata[node.table]
        spec = SPECS[node.table]
        fks = _fk_columns(table)
        for column in table.columns:
            value = node.values.get(column.name)
            if (
                isinstance(column.type, Uuid)
                and value is not None
                and column.name not in spec.external
                and fks.get(column.name) not in REFERENCE_TABLES
                and (column.primary_key or column.name not in fks)
            ):
                ids.setdefault(value, uuid4())
    text_ids = {str(old): str(new) for old, new in ids.items()}

    for node in nodes:
        table = metadata[node.table]
        spec = SPECS[node.table]
        fks = _fk_columns(table)
        for column in table.columns:
            name = column.name
            if name not in node.values:
                continue
            value = node.values[name]
            if value is None:
                continue
            if isinstance(column.type, Uuid):
                if name in spec.external:
                    continue
                if fks.get(name) in REFERENCE_TABLES:
                    node.values[name] = ids.get(value, value)
                    continue
                mapped = ids.get(value)
                if mapped is None:
                    raise package_error(
                        "REFERENCE_MISSING", f"备份引用不完整：{node.table}.{name}。"
                    )
                node.values[name] = mapped
            elif isinstance(column.type, JSON | String) and not isinstance(column.type, Text):
                node.values[name] = _rewrite(value, text_ids)
        if spec.fresh_strings:
            new_pk = node.values[table.primary_key.columns[0].name]
            for name, build in spec.fresh_strings.items():
                node.values[name] = build(new_pk)

    project = nodes[0].values
    assert nodes[0].table == "projects"
    name = cast(str, project["name"])[: 200 - len(RESTORED_SUFFIX)].rstrip() or "项目"
    project.update(name=name + RESTORED_SUFFIX, archived=False, created_at=now, updated_at=now)
    new_project_id = cast(UUID, project["id"])

    # Insert in dependency order; cycle-closing columns are set after every row exists.
    deferred_updates: list[tuple[Table, dict[str, Any], dict[str, Any]]] = []
    batch: list[dict[str, Any]] = []
    batch_table: Table | None = None
    batch_keys: frozenset[str] = frozenset()

    def flush() -> None:
        nonlocal batch
        if batch_table is not None and batch:
            session.execute(insert(batch_table), batch)
        batch = []

    for position in order:
        node = nodes[position]
        table = metadata[node.table]
        spec = SPECS[node.table]
        values = dict(node.values)
        later = {name: values[name] for name in spec.deferred if values.get(name) is not None}
        for name in spec.deferred:
            values[name] = None
        # SQL NULL (not JSON null) for absent nullable JSON values.
        for column in table.columns:
            if (
                isinstance(column.type, JSON)
                and column.nullable
                and values.get(column.name) is None
            ):
                values.pop(column.name, None)
        if later:
            deferred_updates.append(
                (table, {c.name: values[c.name] for c in table.primary_key.columns}, later)
            )
        key_set = frozenset(values)
        if table is not batch_table or key_set != batch_keys:
            flush()
            batch_table, batch_keys = table, key_set
        batch.append(values)
    flush()
    for table, pk, later in deferred_updates:
        condition = and_(*(table.c[name] == value for name, value in pk.items()))
        session.execute(update(table).where(condition).values(**later))
    session.flush()

    interrupted = _finish_restored_jobs(session, new_project_id)
    return RestoreOutcome(new_project_id, prepared.source_project_id, prepared.counts, interrupted)


def _finish_restored_jobs(session: Session, project_id: UUID) -> int:
    """Restored copies never resume work: queued/running jobs end as cancelled, explicitly marked.

    Cancellation goes through the jobs module so dependent state (content-revision candidates)
    ends exactly as a user cancel would. Model calls and writes are never replayed.
    """
    from thesis_pilot.modules.jobs.models import Job
    from thesis_pilot.modules.jobs.service import _cancel_in_transaction

    active = session.scalars(
        select(Job.id)
        .where(Job.project_id == project_id, Job.status.in_(("queued", "running")))
        .order_by(Job.created_at, Job.id)
    ).all()
    for job_id in active:
        job = _cancel_in_transaction(session, job_id, project_id=project_id)
        job.error_code = INTERRUPTED_CODE
    _refresh_job_digests(session, project_id)
    return len(active)


def _refresh_job_digests(session: Session, project_id: UUID) -> None:
    """Fixed-input digests embed record identities; recompute them for the renewed IDs."""
    from thesis_pilot.modules.feedback_splits import service as splits
    from thesis_pilot.modules.feedback_splits.models import FeedbackSplitRun
    from thesis_pilot.modules.jobs.models import Job
    from thesis_pilot.modules.literature.models import LiteratureSearch
    from thesis_pilot.modules.literature.service import job_digest as literature_digest
    from thesis_pilot.modules.plans import service as plans
    from thesis_pilot.modules.plans.models import PlanAdjustment
    from thesis_pilot.modules.reviews import service as reviews
    from thesis_pilot.modules.reviews.models import ReviewRun

    for job in session.scalars(select(Job).where(Job.project_id == project_id)):
        digest: str | None = None
        if job.kind == "literature_search":
            search = session.scalar(
                select(LiteratureSearch).where(LiteratureSearch.job_id == job.id)
            )
            digest = literature_digest(search, job.source_job_id) if search else None
        elif job.kind == "feedback_decomposition":
            split = session.scalar(
                select(FeedbackSplitRun).where(FeedbackSplitRun.job_id == job.id)
            )
            digest = splits._job_digest(split, job.source_job_id) if split else None
        elif job.kind == "review":
            run = session.scalar(select(ReviewRun).where(ReviewRun.job_id == job.id))
            digest = reviews._job_digest(run, job.source_job_id) if run else None
        elif job.kind == "plan_adjustment":
            adjustment = session.scalar(
                select(PlanAdjustment).where(PlanAdjustment.job_id == job.id)
            )
            digest = plans._job_digest(adjustment) if adjustment else None
        if digest is not None and digest != job.request_hash:
            job.request_hash = digest
