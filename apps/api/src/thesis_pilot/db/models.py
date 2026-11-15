from thesis_pilot.modules.documents.models import Document, DocumentVersion
from thesis_pilot.modules.jobs.models import Job, OutboxEvent
from thesis_pilot.modules.projects.models import Project
from thesis_pilot.modules.revisions.models import (
    RevisionCandidate,
    RevisionCommand,
    RevisionProposal,
)
from thesis_pilot.modules.workspace.models import WorkspaceProfile, WorkspaceSession


def register_models() -> tuple[
    type[Project],
    type[Job],
    type[OutboxEvent],
    type[Document],
    type[DocumentVersion],
    type[RevisionCandidate],
    type[RevisionProposal],
    type[RevisionCommand],
    type[WorkspaceProfile],
    type[WorkspaceSession],
]:
    """The single explicit metadata registry used by Alembic and tests."""
    return (
        Project,
        Job,
        OutboxEvent,
        Document,
        DocumentVersion,
        RevisionCandidate,
        RevisionProposal,
        RevisionCommand,
        WorkspaceProfile,
        WorkspaceSession,
    )
