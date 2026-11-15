from thesis_pilot.modules.documents.models import Document, DocumentVersion
from thesis_pilot.modules.jobs.models import Job, OutboxEvent
from thesis_pilot.modules.projects.models import Project


def register_models() -> tuple[
    type[Project], type[Job], type[OutboxEvent], type[Document], type[DocumentVersion]
]:
    """The single explicit metadata registry used by Alembic and tests."""
    return Project, Job, OutboxEvent, Document, DocumentVersion
