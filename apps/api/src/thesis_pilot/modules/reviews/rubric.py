"""Versioned, deterministic review rubrics owned by the review module.

A rubric version is code, not data: its dimensions and explanations never change
after release, so every report can cite the exact scoring basis it was run with.
"""

from dataclasses import dataclass


@dataclass(frozen=True)
class RubricDimension:
    id: str
    name: str
    full: int
    description: str


@dataclass(frozen=True)
class Rubric:
    version: str
    title: str
    description: str
    dimensions: tuple[RubricDimension, ...]
    limitations: tuple[str, ...]


RUBRICS: dict[str, Rubric] = {
    "thesispilot-review-1": Rubric(
        version="thesispilot-review-1",
        title="基础评审量表 v1",
        description="ThesisPilot 自制的通用本科论文参考量表，不代表学校或导师评分标准。",
        dimensions=(
            RubricDimension(
                "structure", "结构与逻辑", 25, "章节层级是否清楚，段落之间是否有明确的推进关系。"
            ),
            RubricDimension(
                "argument", "论证与内容", 35, "观点是否有论据支撑，方法、结果与结论是否相互对应。"
            ),
            RubricDimension(
                "evidence", "文献与依据", 25, "引用与依据是否可追溯，是否存在缺少来源的断言。"
            ),
            RubricDimension(
                "expression",
                "格式与表达",
                15,
                "术语、语句与格式是否规范，是否符合已绑定的模板与要求。",
            ),
        ),
        limitations=(
            "参考分只反映本量表下的模型判断，不是教师成绩，也不代表导师批准。",
            "评审只读取本次固定的正文范围与已绑定资料，未读取的内容列为未检查项。",
            "评审不修改正文或计划；修改须由学生另行发起受控修订。",
        ),
    )
}
DEFAULT_RUBRIC = "thesispilot-review-1"


def rubric_snapshot(rubric: Rubric) -> dict[str, object]:
    return {
        "version": rubric.version,
        "title": rubric.title,
        "description": rubric.description,
        "dimensions": [
            {"id": d.id, "name": d.name, "full": d.full, "description": d.description}
            for d in rubric.dimensions
        ],
        "limitations": list(rubric.limitations),
    }
