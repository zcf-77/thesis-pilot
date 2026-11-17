"""Imported originals keep their source guard across the explicit v2 upgrade."""

from copy import deepcopy
from typing import Any
from uuid import uuid4

import pytest
from sqlalchemy.orm import Session, sessionmaker
from test_source_document_writes import ORIGINAL_TEXT, imported

from thesis_pilot.core.errors import AppError
from thesis_pilot.modules.document_sources.service import current_source
from thesis_pilot.modules.documents import service as documents
from thesis_pilot.modules.documents.schemas import DocumentSave, DocumentSchemaUpgradeCreate
from thesis_pilot.modules.revisions import service as revisions
from thesis_pilot.modules.revisions.schemas import RevisionRevert


def snapshot_save(version: int, snapshot: dict[str, Any]) -> DocumentSave:
    value = deepcopy(snapshot)
    value.pop("chapters", None)
    return DocumentSave.model_validate(
        {"expected_version": version, "content": {"schema_version": 2, "json": value}}
    )


def test_source_bound_upgrade_maps_editable_paths_to_nodes(
    session_factory: sessionmaker[Session],
) -> None:
    project_id, document_id = imported(session_factory)
    with session_factory() as session:
        result = documents.upgrade_schema(
            session,
            project_id,
            document_id,
            DocumentSchemaUpgradeCreate(command_id=uuid4(), expected_version=1),
        )
    assert result.document.version == 2
    snapshot = result.document.content.model_dump(by_alias=True)["json"]
    kinds = [item["kind"] for item in snapshot["protections"]]
    assert kinds == ["object"]
    with session_factory() as session:
        source = current_source(session, project_id, document_id)
    assert source.guard_version == "source-model-v2"
    assert source.guard_contract["upgraded_from_version"] == 1
    editable = source.guard_contract["editable_nodes"]
    blocks = snapshot["model"]["sections"][0]["blocks"]
    assert editable == [blocks[0]["id"]]
    assert blocks[0]["inlines"] == [{"type": "run", "text": ORIGINAL_TEXT}]

    changed = deepcopy(snapshot)
    changed["model"]["sections"][0]["blocks"][0]["inlines"][0]["text"] = "采用方法乙。"
    with session_factory() as session:
        saved = documents.save_document(session, project_id, document_id, snapshot_save(2, changed))
    assert saved.version == 3
    with session_factory() as session:
        assert current_source(session, project_id, document_id).guard_version == "source-model-v2"

    restyled = deepcopy(changed)
    restyled["model"]["sections"][0]["blocks"][0]["props"] = {"align": "center"}
    with session_factory() as session, pytest.raises(AppError) as raised:
        documents.save_document(session, project_id, document_id, snapshot_save(3, restyled))
    assert raised.value.code == "DOCUMENT_SOURCE_PROTECTED"

    with session_factory() as session, pytest.raises(AppError) as raised:
        revisions.revert_document(
            session,
            project_id,
            document_id,
            RevisionRevert(command_id=uuid4(), expected_document_version=3, target_version=1),
        )
    assert raised.value.code == "DOCUPGRADE_REVERT_UNSUPPORTED"
    with session_factory() as session:
        reverted = revisions.revert_document(
            session,
            project_id,
            document_id,
            RevisionRevert(command_id=uuid4(), expected_document_version=3, target_version=2),
        )
    assert reverted.result_version == 4
