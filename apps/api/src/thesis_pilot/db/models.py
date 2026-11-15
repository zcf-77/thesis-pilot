from thesis_pilot.modules.ai_configs.models import AIConfig, AIConfigVersion
from thesis_pilot.modules.documents.models import Document, DocumentVersion
from thesis_pilot.modules.jobs.models import Job, JobArtifact, JobAttempt, OutboxEvent
from thesis_pilot.modules.project_flows.models import ProjectFlow, ProjectFlowVersion
from thesis_pilot.modules.projects.models import Project
from thesis_pilot.modules.revisions.models import (
    RevisionCandidate,
    RevisionCommand,
    RevisionProposal,
)
from thesis_pilot.modules.workspace.models import WorkspaceProfile, WorkspaceSession


def register_models() -> tuple[
    type[AIConfig],
    type[AIConfigVersion],
    type[Project],
    type[ProjectFlow],
    type[ProjectFlowVersion],
    type[Job],
    type[JobAttempt],
    type[JobArtifact],
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
        AIConfig,
        AIConfigVersion,
        Project,
        ProjectFlow,
        ProjectFlowVersion,
        Job,
        JobAttempt,
        JobArtifact,
        OutboxEvent,
        Document,
        DocumentVersion,
        RevisionCandidate,
        RevisionProposal,
        RevisionCommand,
        WorkspaceProfile,
        WorkspaceSession,
    )
