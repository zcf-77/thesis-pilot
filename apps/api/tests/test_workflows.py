import json
from uuid import uuid4

from thesis_pilot.workflows.diagnostic import run_diagnostic


def test_diagnostic_produces_json_safe_result_bound_to_request() -> None:
    job_id, project_id = uuid4(), uuid4()

    result = run_diagnostic(job_id, project_id)

    assert result["job_id"] == str(job_id)
    assert result["project_id"] == str(project_id)
    assert result["kind"] == "diagnostic"
    assert result["checked"] is True
    assert result["model_used"] is False
    assert result["writes_performed"] is False
    assert json.loads(json.dumps(result, ensure_ascii=False)) == result


def test_repeated_diagnostic_does_not_share_mutable_results() -> None:
    job_id, project_id = uuid4(), uuid4()
    first = run_diagnostic(job_id, project_id)
    expected = dict(first)
    first["checked"] = False

    assert run_diagnostic(job_id, project_id) == expected


def test_distinct_projects_do_not_reuse_previous_context() -> None:
    first_job, second_job, first_project, second_project = (uuid4() for _ in range(4))
    first = run_diagnostic(first_job, first_project)
    second = run_diagnostic(second_job, second_project)

    assert first["project_id"] == str(first_project)
    assert second["project_id"] == str(second_project)
    assert first["job_id"] != second["job_id"]
