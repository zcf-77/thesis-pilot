"""无模型、无数据库副作用的 LangGraph 接入探针。

该图只验证编排与结构化结果边界；不宣称具备持久 checkpoint 或论文评审能力。
任务持久状态、租约、取消与结果保存由 jobs 服务维护。
"""

from typing import NotRequired, TypedDict
from uuid import UUID

from langgraph.graph import END, START, StateGraph


class DiagnosticState(TypedDict):
    job_id: str
    project_id: str
    result: NotRequired[dict[str, object]]


def _inspect_context(state: DiagnosticState) -> dict[str, dict[str, object]]:
    return {
        "result": {
            "kind": "diagnostic",
            "job_id": state["job_id"],
            "project_id": state["project_id"],
            "checked": True,
            "model_used": False,
            "writes_performed": False,
            "message": "编排诊断完成；未调用模型，未修改论文或计划。",
        }
    }


_builder = StateGraph(DiagnosticState)
_builder.add_node("inspect_context", _inspect_context)
_builder.add_edge(START, "inspect_context")
_builder.add_edge("inspect_context", END)
_graph = _builder.compile()


def run_diagnostic(job_id: UUID, project_id: UUID) -> dict[str, object]:
    """运行一次确定性诊断；仅接收标识，不接受提示词、正文或任意工具名。"""
    initial: DiagnosticState = {"job_id": str(job_id), "project_id": str(project_id)}
    result: dict[str, object] = _graph.invoke(initial)["result"]
    return result
