from thesis_pilot.modules.ai_configs.models import AIConfig, AIConfigVersion
from thesis_pilot.modules.assistant_sessions.models import (
    AssistantCommand,
    AssistantMessage,
    AssistantRun,
    AssistantSession,
)
from thesis_pilot.modules.document_sources.models import DocumentSource, DocumentSourceVersion
from thesis_pilot.modules.documents.models import Document, DocumentVersion
from thesis_pilot.modules.feedback.models import FeedbackBatch, FeedbackItem, FeedbackItemVersion
from thesis_pilot.modules.format_revisions.models import FormatCandidate, FormatCommandReceipt
from thesis_pilot.modules.jobs.models import Job, JobArtifact, JobAttempt, OutboxEvent
from thesis_pilot.modules.materials.models import (
    Material,
    MaterialOriginal,
    MaterialParseVersion,
    ProjectSourceBinding,
    ProjectSourceBindingVersion,
)
from thesis_pilot.modules.project_flows.models import ProjectFlow, ProjectFlowVersion
from thesis_pilot.modules.projects.models import Project
from thesis_pilot.modules.revisions.models import (
    RevisionCandidate,
    RevisionCommand,
    RevisionProposal,
)
from thesis_pilot.modules.tasks.models import (
    ProjectTask,
    TaskBoard,
    TaskFeedbackCommand,
    TaskVersion,
)
from thesis_pilot.modules.workspace.models import WorkspaceProfile, WorkspaceSession


def register_models() -> tuple[
    type[TaskBoard],
    type[ProjectTask],
    type[TaskVersion],
    type[TaskFeedbackCommand],
    type[FeedbackBatch],
    type[FeedbackItem],
    type[FeedbackItemVersion],
    type[FormatCandidate],
    type[FormatCommandReceipt],
    type[AssistantSession],
    type[AssistantMessage],
    type[AssistantRun],
    type[AssistantCommand],
    type[DocumentSource],
    type[DocumentSourceVersion],
    type[Material],
    type[MaterialOriginal],
    type[MaterialParseVersion],
    type[ProjectSourceBinding],
    type[ProjectSourceBindingVersion],
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
        TaskBoard,
        ProjectTask,
        TaskVersion,
        TaskFeedbackCommand,
        FeedbackBatch,
        FeedbackItem,
        FeedbackItemVersion,
        FormatCandidate,
        FormatCommandReceipt,
        AssistantSession,
        AssistantMessage,
        AssistantRun,
        AssistantCommand,
        DocumentSource,
        DocumentSourceVersion,
        Material,
        MaterialOriginal,
        MaterialParseVersion,
        ProjectSourceBinding,
        ProjectSourceBindingVersion,
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
