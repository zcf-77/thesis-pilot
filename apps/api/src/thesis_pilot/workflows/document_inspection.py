"""Deterministic inspection of one fixed, saved manuscript version."""

from thesis_pilot.modules.documents.content import ContentView
from thesis_pilot.modules.documents.structure import JsonObject
from thesis_pilot.modules.jobs.service import JobClaim


def run_document_inspection(
    claim: JobClaim, content: ContentView | JsonObject
) -> dict[str, object]:
    source, configuration = claim.input_snapshot, claim.configuration
    if source is None or configuration is None:
        raise ValueError("结构检查缺少固定输入。")
    # A bare JSON object is a v1 Tiptap document (historical callers).
    view = content if isinstance(content, ContentView) else ContentView.of(1, content)
    counts = view.inspection_counts()
    return {
        "kind": "document_inspection",
        "schema_version": 1,
        "job_id": str(claim.job_id),
        "project_id": str(claim.project_id),
        "document_id": str(source.document_id),
        "document_version": source.document_version,
        "node_count": counts["node_count"],
        "paragraph_count": counts["paragraph_count"],
        "heading_count": counts["heading_count"],
        "table_count": counts["table_count"],
        "text_characters": (
            counts["text_characters"] if configuration.include_text_statistics else None
        ),
        "model_used": False,
        "writes_performed": False,
    }
