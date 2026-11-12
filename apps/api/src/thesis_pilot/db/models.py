from thesis_pilot.modules.jobs.models import Job, OutboxEvent
from thesis_pilot.modules.projects.models import Project


def register_models() -> tuple[type[Project], type[Job], type[OutboxEvent]]:
    """The single explicit metadata registry used by Alembic and tests."""
    return Project, Job, OutboxEvent
