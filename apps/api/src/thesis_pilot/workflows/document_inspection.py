"""Deterministic inspection of one fixed, saved manuscript version."""

from thesis_pilot.modules.documents.structure import JsonObject, canonical_editor_json
from thesis_pilot.modules.jobs.service import JobClaim


def run_document_inspection(claim: JobClaim, content: JsonObject) -> dict[str, object]:
    source, configuration = claim.input_snapshot, claim.configuration
    if source is None or configuration is None:
        raise ValueError("结构检查缺少固定输入。")
    root = canonical_editor_json(content)
    stack = [root]
    node_count = paragraph_count = heading_count = table_count = text_characters = 0
    while stack:
        node = stack.pop()
        node_count += 1
        paragraph_count += node.get("type") == "paragraph"
        heading_count += node.get("type") == "heading"
        table_count += node.get("type") == "table"
        text = node.get("text")
        if isinstance(text, str):
            text_characters += len(text)
        children = node.get("content")
        if isinstance(children, list):
            stack.extend(child for child in children if isinstance(child, dict))
    return {
        "kind": "document_inspection",
        "schema_version": 1,
        "job_id": str(claim.job_id),
        "project_id": str(claim.project_id),
        "document_id": str(source.document_id),
        "document_version": source.document_version,
        "node_count": node_count,
        "paragraph_count": paragraph_count,
        "heading_count": heading_count,
        "table_count": table_count,
        "text_characters": text_characters if configuration.include_text_statistics else None,
        "model_used": False,
        "writes_performed": False,
    }
