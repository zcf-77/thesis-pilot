"""Source guard v2 for DocsModel snapshots of originals imported from a fixed file.

At upgrade, every v1 editable path is mapped to its converted node id. From then on a
save may change only the run text of those editable paragraphs/headings (one run, the
original run formatting); every other node, property and order is frozen by a digest
of the model skeleton. The contract also pins the initial v1 import contract.
"""

from __future__ import annotations

import json
from copy import deepcopy
from hashlib import sha256
from typing import Literal, cast

from pydantic import BaseModel, ConfigDict, Field, ValidationError

from thesis_pilot.core.errors import AppError
from thesis_pilot.modules.documents.docs_model import JsonDict, find_block, model_of
from thesis_pilot.modules.documents.structure import JsonObject

MODEL_GUARD_VERSION: Literal["source-model-v2"] = "source-model-v2"
PLACEHOLDER = "MAPPED_EDITABLE_TEXT"


class ModelGuardContract(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    schema_version: Literal[3] = 3
    guard_version: Literal["source-model-v2"] = MODEL_GUARD_VERSION
    initial_contract_sha256: str = Field(pattern=r"^[0-9a-f]{64}$")
    upgraded_from_version: int = Field(ge=1)
    editable_nodes: list[str] = Field(max_length=20000)
    skeleton_sha256: str = Field(pattern=r"^[0-9a-f]{64}$")


def guard_invalid() -> AppError:
    return AppError(
        "DOCUMENT_SOURCE_GUARD_INVALID", "正式稿来源保护映射缺失或不一致，当前稿保持不变。", 409
    )


def protected() -> AppError:
    return AppError(
        "DOCUMENT_SOURCE_PROTECTED",
        "此原件仅支持映射文字编辑，章节、格式和受保护对象保持不变。",
        409,
    )


def digest(value: object) -> str:
    raw = json.dumps(value, sort_keys=True, ensure_ascii=False, separators=(",", ":"))
    return sha256(raw.encode()).hexdigest()


def is_model_guard(contract: JsonObject) -> bool:
    return contract.get("guard_version") == MODEL_GUARD_VERSION


def parse(contract: JsonObject) -> ModelGuardContract:
    try:
        return ModelGuardContract.model_validate(contract)
    except ValidationError as error:
        raise guard_invalid() from error


def skeleton(model: JsonDict, editable: list[str]) -> JsonDict:
    """Freeze everything except the single run text of each editable block."""
    result = deepcopy(model)
    for node_id in editable:
        block = find_block(result, node_id)
        if block is None or block.get("type") not in {"paragraph", "heading"}:
            raise protected()
        inlines = cast(list[JsonDict], block["inlines"])
        if len(inlines) > 1 or any(inline.get("type") != "run" for inline in inlines):
            raise protected()
        run: JsonDict = {"type": "run", "text": PLACEHOLDER}
        if inlines and inlines[0].get("props"):
            run["props"] = deepcopy(inlines[0]["props"])
        block["inlines"] = [run]
    return result


def build_upgrade_contract(
    *,
    initial_contract: JsonObject,
    editable_paths: list[list[int]],
    node_map: dict[tuple[int, ...], str],
    snapshot: JsonDict,
    upgraded_from_version: int,
) -> JsonObject:
    try:
        editable = [node_map[tuple(path)] for path in editable_paths]
    except KeyError as error:
        raise guard_invalid() from error
    if len(set(editable)) != len(editable):
        raise guard_invalid()
    contract = ModelGuardContract(
        initial_contract_sha256=digest(initial_contract),
        upgraded_from_version=upgraded_from_version,
        editable_nodes=editable,
        skeleton_sha256=digest(skeleton(model_of(snapshot), editable)),
    )
    return cast(JsonObject, contract.model_dump(mode="json"))


def validate_model_guard(
    contract: JsonObject, snapshot: JsonDict, initial_contract: JsonObject
) -> None:
    frozen = parse(contract)
    if frozen.initial_contract_sha256 != digest(initial_contract):
        raise guard_invalid()
    if digest(skeleton(model_of(snapshot), frozen.editable_nodes)) != frozen.skeleton_sha256:
        raise protected()


def rebind_skeleton(contract: JsonObject, snapshot: JsonDict) -> JsonObject:
    """Internal only: a server-built format adoption re-freezes its result's skeleton.

    The editable node list and the initial contract stay fixed; only the skeleton digest
    follows the whitelisted heading/paragraph properties that the format command applied.
    Callers pass the result through ``transition_for_contract`` in the same locked
    transaction; an ordinary save can never carry a rebound contract.
    """
    frozen = parse(contract)
    rebound = frozen.model_copy(
        update={"skeleton_sha256": digest(skeleton(model_of(snapshot), frozen.editable_nodes))}
    )
    return cast(JsonObject, rebound.model_dump(mode="json"))
