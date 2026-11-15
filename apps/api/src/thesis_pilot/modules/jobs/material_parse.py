"""Parse one immutable database original. No paths, external services or manuscript writes."""

from sqlalchemy.orm import Session, sessionmaker

from thesis_pilot.core.errors import AppError
from thesis_pilot.modules.jobs.service import JobClaim, load_material_parse_bytes
from thesis_pilot.parsers.materials import parse_original
from thesis_pilot.parsers.schemas import ParsedMaterial

PARSER_VERSION = "thesispilot-material-1"


def run_material_parse(factory: sessionmaker[Session], claim: JobClaim) -> ParsedMaterial | None:
    source, config = claim.material_input, claim.material_configuration
    if source is None or config is None:
        raise AppError("JOB_INPUT_INVALID", "资料解析缺少固定原件与解析器配置。", 422)
    if config.parser_version != PARSER_VERSION:
        raise AppError(
            "MATERIAL_PARSER_VERSION_UNAVAILABLE", "当前解析器不支持固定的历史版本。", 422
        )
    data = load_material_parse_bytes(factory, claim)
    if data is None:
        return None
    return parse_original(data, source.original_version_id, config.file_type)
