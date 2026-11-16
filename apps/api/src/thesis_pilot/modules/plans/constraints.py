"""Deterministic plan constraints (AC-009). Prompts never decide whether a date is allowed.

Every check only reads the facts passed in; callers decide whether a violation blocks a
candidate item (generation) or rejects the whole command (adoption, revert, manual batch).
"""

from dataclasses import dataclass, replace
from datetime import date
from uuid import UUID

Violation = tuple[str, str]


@dataclass(frozen=True)
class TaskFacts:
    task_id: UUID
    title: str
    version: int
    status: str
    archived: bool
    start_date: date | None
    due_date: date | None
    hard_deadline: date | None
    depends_on: tuple[UUID, ...]


@dataclass(frozen=True)
class Proposed:
    start_date: date | None
    due_date: date | None


def _iso(value: date) -> str:
    return value.isoformat()


def own_violations(
    task: TaskFacts,
    change: Proposed,
    deadline: date | None,
    today: date | None,
) -> list[Violation]:
    """Checks that do not depend on any other task."""
    found: list[Violation] = []
    if task.archived:
        found.append(("ARCHIVED_TASK", "归档任务不参与计划调整。"))
    if task.status == "confirmed":
        found.append(("CONFIRMED_TASK", "已确认完成的任务不调整日期。"))
    start, due = change.start_date, change.due_date
    if start is not None and due is not None and start > due:
        found.append(("DATE_ORDER", f"开始 {_iso(start)} 晚于预计完成 {_iso(due)}。"))
    hard = task.hard_deadline
    if hard is not None and any(day is not None and day > hard for day in (start, due)):
        found.append(("HARD_DEADLINE", f"越过该任务的硬截止 {_iso(hard)}。"))
    if deadline is not None and any(day is not None and day > deadline for day in (start, due)):
        found.append(("PROJECT_DEADLINE", f"越过项目截止 {_iso(deadline)}。"))
    if today is not None:
        moved = [
            day
            for day, before in ((start, task.start_date), (due, task.due_date))
            if day is not None and day != before and day < today
        ]
        if moved:
            found.append(("PAST_DATE", f"调整后的日期早于今天 {_iso(today)}。"))
    return found


def _final(task: TaskFacts, changes: dict[UUID, Proposed]) -> TaskFacts:
    change = changes.get(task.task_id)
    if change is None:
        return task
    return replace(task, start_date=change.start_date, due_date=change.due_date)


def dependency_violations(
    tasks: dict[UUID, TaskFacts], changes: dict[UUID, Proposed]
) -> dict[UUID, list[Violation]]:
    """A predecessor must be due no later than its successor starts, after applying changes.

    Only relations that touch a changed task are reported, so pre-existing conflicts between
    untouched tasks never block an unrelated adjustment.
    """
    found: dict[UUID, list[Violation]] = {}
    final = {task_id: _final(task, changes) for task_id, task in tasks.items()}
    for task_id in changes:
        task = final.get(task_id)
        if task is None:
            continue
        begin = task.start_date or task.due_date
        for dependency_id in task.depends_on:
            dependency = final.get(dependency_id)
            if dependency is None or dependency.archived or dependency.due_date is None:
                continue
            if begin is not None and dependency.due_date > begin:
                found.setdefault(task_id, []).append(
                    (
                        "DEPENDENCY_ORDER",
                        f"前置任务「{dependency.title}」预计 {_iso(dependency.due_date)} 完成，"
                        f"晚于本任务开始 {_iso(begin)}。",
                    )
                )
        for successor in final.values():
            if task_id not in successor.depends_on or successor.archived:
                continue
            successor_begin = successor.start_date or successor.due_date
            if (
                task.due_date is not None
                and successor_begin is not None
                and task.due_date > successor_begin
            ):
                found.setdefault(task_id, []).append(
                    (
                        "DEPENDENCY_ORDER",
                        f"后续任务「{successor.title}」{_iso(successor_begin)} 开始，"
                        f"早于本任务预计完成 {_iso(task.due_date)}。",
                    )
                )
    return found


def check_changes(
    tasks: dict[UUID, TaskFacts],
    changes: dict[UUID, Proposed],
    deadline: date | None,
    today: date | None,
) -> dict[UUID, list[Violation]]:
    """All violations of a complete set of changes applied together."""
    found: dict[UUID, list[Violation]] = {}
    for task_id, change in changes.items():
        task = tasks.get(task_id)
        if task is None:
            found[task_id] = [("UNKNOWN_TASK", "任务不属于本项目。")]
            continue
        own = own_violations(task, change, deadline, today)
        if own:
            found[task_id] = own
    for task_id, items in dependency_violations(tasks, changes).items():
        found.setdefault(task_id, []).extend(items)
    return found


def consistent_subset(
    tasks: dict[UUID, TaskFacts],
    changes: dict[UUID, Proposed],
    deadline: date | None,
    today: date | None,
) -> dict[UUID, list[Violation]]:
    """Block items until the remaining set is valid as a whole (fixed point).

    Items failing their own checks are removed first, so a blocked predecessor's current dates
    (not its rejected suggestion) are what its neighbours are checked against. Blocking is
    monotone, so the loop ends in at most len(changes) rounds; the surviving items are valid
    together, and adoption re-checks whichever subset the student selects.
    """
    blocked: dict[UUID, list[Violation]] = {}
    remaining: dict[UUID, Proposed] = {}
    for task_id, change in changes.items():
        task = tasks.get(task_id)
        own = (
            [("UNKNOWN_TASK", "任务不属于本项目。")]
            if task is None
            else own_violations(task, change, deadline, today)
        )
        if own:
            blocked[task_id] = own
        else:
            remaining[task_id] = change
    for _ in range(len(remaining) + 1):
        found = dependency_violations(tasks, remaining)
        if not found:
            break
        for task_id, items in found.items():
            blocked.setdefault(task_id, []).extend(items)
            remaining.pop(task_id, None)
    return blocked
