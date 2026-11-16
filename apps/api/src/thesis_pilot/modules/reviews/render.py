"""Deterministic report files; every model string is escaped as untrusted text."""

from html import escape

from thesis_pilot.modules.reviews.schemas import ReviewIssue, ReviewRead, ReviewReportRead

SEVERITY = {"major": "严重", "minor": "一般", "advice": "建议"}


def _location(issue: ReviewIssue) -> str:
    location = issue.location
    if location.status == "unlocated":
        return "无法定位"
    parts = [location.chapter_title or ("正文开头" if location.chapter_id is None else "章节")]
    if location.block_index is not None:
        parts.append(f"第 {location.block_index + 1} 个正文块")
    if location.quote:
        parts.append(f"“{location.quote}”")
    return " · ".join(parts)


def _basis(issue: ReviewIssue) -> str:
    return "；".join(item.label for item in issue.basis) if issue.basis else "缺依据"


def _facts(review: ReviewRead, report: ReviewReportRead) -> list[tuple[str, str]]:
    content = report.content
    return [
        ("评审范围", content.scope.title),
        ("正文版本", f"v{report.document_version}"),
        ("评审量表", f"{content.rubric.title}（{content.rubric.version}）"),
        ("评审智能体", review.agent_name),
        ("模型", f"{report.requested_model}（响应 {report.response_model}）"),
        (
            "模板与要求",
            "未绑定"
            if review.source_binding_version_id is None
            else f"绑定版本 {review.source_binding_version_id}",
        ),
        ("生成时间", report.created_at.isoformat()),
    ]


def _score(value: float | None, full: int) -> str:
    return "不能判定" if value is None else f"{value:g} / {full}"


def render_markdown(review: ReviewRead, report: ReviewReportRead) -> str:
    content = report.content
    lines = ["# 论文评审报告", ""]
    lines += [f"- {key}：{value}" for key, value in _facts(review, report)]
    lines += ["", "> 仅评审，不改稿。参考分不是教师成绩，也不代表导师批准。", "", "## 摘要", ""]
    lines += [content.summary, "", "## 分项参考评分", ""]
    for score in content.scores:
        reason = f"：{score.reason}" if score.reason else ""
        lines.append(f"- {score.name}：{_score(score.score, score.full)}{reason}")
    lines += ["", "## 问题清单", ""]
    if not content.issues:
        lines.append("本次未列出问题；这不代表论文不存在问题。")
    for issue in content.issues:
        lines += [
            f"### [{SEVERITY[issue.severity]}] {issue.title}",
            "",
            f"- 位置：{_location(issue)}",
            f"- 依据：{_basis(issue)}",
            f"- 说明：{issue.explanation}",
            f"- 修改方向：{issue.direction}",
            "",
        ]
    lines += ["## 未检查项", ""]
    lines += [f"- {item.item}：{item.reason}" for item in content.unchecked] or ["- 无"]
    lines += ["", "## 局限", ""]
    lines += [f"- {item}" for item in content.limitations]
    return "\n".join(lines) + "\n"


def render_html(review: ReviewRead, report: ReviewReportRead) -> str:
    content = report.content
    e = escape
    facts = "".join(f"<dt>{e(k)}</dt><dd>{e(v)}</dd>" for k, v in _facts(review, report))
    scores = "".join(
        f"<tr><td>{e(s.name)}</td><td>{e(_score(s.score, s.full))}</td><td>{e(s.reason)}</td></tr>"
        for s in content.scores
    )
    issues = (
        "".join(
            f"<article><h3>[{e(SEVERITY[i.severity])}] {e(i.title)}</h3><ul>"
            f"<li>位置：{e(_location(i))}</li><li>依据：{e(_basis(i))}</li>"
            f"<li>说明：{e(i.explanation)}</li><li>修改方向：{e(i.direction)}</li></ul></article>"
            for i in content.issues
        )
        or "<p>本次未列出问题；这不代表论文不存在问题。</p>"
    )
    unchecked = "".join(f"<li>{e(u.item)}：{e(u.reason)}</li>" for u in content.unchecked)
    limitations = "".join(f"<li>{e(item)}</li>" for item in content.limitations)
    return (
        '<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">'
        '<meta name="viewport" content="width=device-width,initial-scale=1">'
        "<title>论文评审报告</title><style>body{font-family:system-ui,sans-serif;"
        "max-width:820px;margin:40px auto;padding:0 16px;line-height:1.7}"
        "dt{font-weight:600}dd{margin:0 0 8px}table{border-collapse:collapse;width:100%}"
        "td,th{border:1px solid #ccc;padding:6px 8px;text-align:left}</style></head><body>"
        f"<h1>论文评审报告</h1><dl>{facts}</dl>"
        "<p><strong>仅评审，不改稿。</strong>参考分不是教师成绩，也不代表导师批准。</p>"
        f"<h2>摘要</h2><p>{e(content.summary)}</p>"
        "<h2>分项参考评分</h2><table><thead><tr><th>维度</th><th>参考分</th><th>理由</th>"
        f"</tr></thead><tbody>{scores}</tbody></table>"
        f"<h2>问题清单</h2>{issues}"
        f"<h2>未检查项</h2><ul>{unchecked or '<li>无</li>'}</ul>"
        f"<h2>局限</h2><ul>{limitations}</ul></body></html>"
    )
