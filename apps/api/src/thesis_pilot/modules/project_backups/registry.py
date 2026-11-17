"""Object registry: which tables a project backup contains and how each is scoped and remapped.

Every table in the application metadata must be classified exactly once:

* ``PROJECT_TABLES`` – project-owned rows exported to ``data/<table>.jsonl`` and restored with
  new identities. ``scope`` says how a row belongs to the project: either a column that *is*
  the project id (``Scope("project_id")``) or a column referencing a parent table already in
  the registry (``Scope("document_id", "documents")``).
* ``REFERENCE_TABLES`` – instance configuration a project row may reference by foreign key
  (flows). Referenced rows are packaged and, on restore, reused when identical or copied.
* ``EXCLUDED_TABLES`` – instance state that never belongs to one project (workspace session,
  configuration library, transport outbox, the backup tables themselves).

Remapping is generic: every UUID value in a project row receives a new UUID (the same old value
always maps to the same new one), except columns listed in ``external`` (references to the
instance configuration library) and foreign keys into reference tables. The same map is then
applied to UUID strings inside JSON and short string columns, so anchors, evidence and snapshots
keep pointing at the restored copies. Manuscript node IDs are not UUID row identities and stay.

To register a new project table, add a ``TableSpec`` here (and nothing else): declare its scope,
any nullable foreign keys that close a reference cycle (``deferred``: inserted NULL then set by
UPDATE, so they must be updatable under the table's triggers), any UUID columns pointing at the
configuration library (``external``) and any globally unique string column that must be renewed
(``fresh_strings``). ``tests/test_backups.py`` fails until every table is classified.
"""

from collections.abc import Callable
from dataclasses import dataclass, field
from uuid import UUID

from sqlalchemy import Column, Table, Uuid

from thesis_pilot.db.base import Base
from thesis_pilot.db.models import register_models
from thesis_pilot.modules.project_backups.contracts import BACKUP_JOB_KINDS


@dataclass(frozen=True)
class Scope:
    column: str
    parent: str | None = None
    parent_column: str = "id"


@dataclass(frozen=True)
class TableSpec:
    table: str
    scope: Scope
    deferred: tuple[str, ...] = ()
    external: tuple[str, ...] = ()
    # column -> builder(new primary key) for globally unique strings that cannot be copied.
    fresh_strings: dict[str, Callable[[UUID], str]] = field(default_factory=dict)
    # Rows of this table that are not part of a backup (e.g. backup/restore jobs themselves).
    excluded_kinds: tuple[str, ...] = ()


def _restored_key(prefix: str) -> Callable[[UUID], str]:
    return lambda new_id: f"{prefix}:{new_id}"


PROJECT = Scope("project_id")
AGENT = ("agent_config_version_id",)

PROJECT_TABLES: tuple[TableSpec, ...] = (
    TableSpec("projects", Scope("id")),
    # Manuscript and its immutable history.
    TableSpec("documents", PROJECT),
    TableSpec("document_versions", Scope("document_id", "documents")),
    TableSpec("document_schema_upgrades", Scope("document_id", "documents")),
    TableSpec("document_resources", PROJECT),
    TableSpec("document_sources", Scope("document_id", "documents")),
    TableSpec("document_source_versions", Scope("document_id", "documents")),
    # Materials, originals, parses and project source bindings.
    TableSpec("materials", PROJECT, deferred=("current_original_id",)),
    TableSpec(
        "material_originals",
        Scope("material_id", "materials"),
        deferred=("latest_parse_id",),
        fresh_strings={"upload_key": _restored_key("restore")},
    ),
    TableSpec("material_parse_versions", Scope("original_id", "material_originals")),
    TableSpec("project_source_bindings", PROJECT, deferred=("current_version_id",)),
    TableSpec("project_source_binding_versions", PROJECT),
    # Tasks and feedback.
    TableSpec("task_boards", PROJECT),
    TableSpec("project_tasks", PROJECT),
    TableSpec("task_versions", Scope("task_id", "project_tasks")),
    TableSpec("task_feedback_commands", PROJECT),
    TableSpec("feedback_batches", PROJECT),
    TableSpec("feedback_items", PROJECT),
    TableSpec("feedback_item_versions", Scope("item_id", "feedback_items")),
    TableSpec("feedback_split_runs", PROJECT, external=AGENT),
    TableSpec("feedback_split_suggestions", PROJECT),
    TableSpec("feedback_split_decisions", PROJECT),
    # Stage confirmations, notifications, plans.
    TableSpec("stage_confirmations", PROJECT),
    TableSpec("notifications", PROJECT),
    TableSpec("notification_events", PROJECT),
    TableSpec("notification_commands", PROJECT),
    TableSpec("plan_adjustments", PROJECT, external=AGENT),
    TableSpec("plan_proposals", PROJECT),
    TableSpec("plan_versions", PROJECT),
    TableSpec("plan_decisions", PROJECT),
    # Content and format revisions.
    TableSpec("revision_candidates", Scope("document_id", "documents")),
    TableSpec("revision_proposals", Scope("candidate_id", "revision_candidates")),
    TableSpec("revision_commands", Scope("document_id", "documents")),
    TableSpec("format_candidates", Scope("document_id", "documents")),
    TableSpec("format_commands", Scope("document_id", "documents")),
    # Assistant sessions and runs.
    TableSpec("assistant_sessions", PROJECT),
    TableSpec("assistant_messages", Scope("session_id", "assistant_sessions")),
    TableSpec("assistant_runs", PROJECT, deferred=("candidate_id", "result_message_id")),
    TableSpec("assistant_commands", PROJECT),
    # Reviews, exports, literature.
    TableSpec("review_runs", PROJECT, external=AGENT),
    TableSpec("review_reports", PROJECT),
    TableSpec("export_files", PROJECT),
    TableSpec("literature_searches", PROJECT),
    TableSpec("literature_search_snapshots", PROJECT),
    TableSpec("literature_entries", PROJECT),
    TableSpec("literature_entry_versions", PROJECT),
    # Job history (backup/restore jobs are transport for this feature, not project history).
    TableSpec(
        "jobs",
        PROJECT,
        fresh_strings={"idempotency_key": _restored_key("restore")},
        excluded_kinds=tuple(sorted(BACKUP_JOB_KINDS)),
    ),
    TableSpec("job_attempts", Scope("job_id", "jobs")),
    TableSpec("job_artifacts", Scope("job_id", "jobs")),
)

REFERENCE_TABLES = ("project_flows", "project_flow_versions")
EXCLUDED_TABLES = (
    "ai_configs",
    "ai_config_versions",
    "reminder_settings",
    "workspace_profiles",
    "workspace_sessions",
    "outbox_events",
    "backup_archives",
    "project_restores",
)

SPECS: dict[str, TableSpec] = {spec.table: spec for spec in PROJECT_TABLES}


def tables() -> dict[str, Table]:
    register_models()
    return dict(Base.metadata.tables)


def uuid_columns(table: Table) -> list[Column[object]]:
    return [column for column in table.columns if isinstance(column.type, Uuid)]


def validate_registry() -> list[str]:
    """Return every classification problem; an empty list means the registry is complete."""
    problems: list[str] = []
    metadata = tables()
    known = set(SPECS) | set(REFERENCE_TABLES) | set(EXCLUDED_TABLES)
    if len(known) != len(SPECS) + len(REFERENCE_TABLES) + len(EXCLUDED_TABLES):
        problems.append("a table is classified more than once")
    for name in sorted(set(metadata) - known):
        problems.append(f"{name}: not registered for backup (add a TableSpec or exclude it)")
    for name in sorted(known - set(metadata)):
        problems.append(f"{name}: registered but not in metadata")
    for spec in PROJECT_TABLES:
        table = metadata.get(spec.table)
        if table is None:
            continue
        if spec.scope.column not in table.columns:
            problems.append(f"{spec.table}: scope column {spec.scope.column} missing")
        if spec.scope.parent is not None and spec.scope.parent not in SPECS:
            problems.append(
                f"{spec.table}: scope parent {spec.scope.parent} is not a project table"
            )
        for name in spec.deferred:
            column = table.columns.get(name)
            if column is None or not column.nullable or not column.foreign_keys:
                problems.append(f"{spec.table}.{name}: deferred column must be a nullable FK")
        for name in spec.external:
            column = table.columns.get(name)
            if column is None or not isinstance(column.type, Uuid) or column.foreign_keys:
                problems.append(f"{spec.table}.{name}: external column must be a non-FK UUID")
        for name in spec.fresh_strings:
            if name not in table.columns:
                problems.append(f"{spec.table}.{name}: fresh string column missing")
        if spec.excluded_kinds and "kind" not in table.columns:
            problems.append(f"{spec.table}: excluded kinds need a kind column")
        for constraint in table.foreign_key_constraints:
            target = constraint.referred_table.name
            if target not in SPECS and target not in REFERENCE_TABLES:
                problems.append(f"{spec.table}: foreign key to unregistered table {target}")
    return problems
