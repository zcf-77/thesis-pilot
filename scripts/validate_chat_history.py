"""Check ThesisPilot's shareable chat history and its local evidence references."""

from __future__ import annotations

import argparse
import base64
import binascii
from collections import Counter
from datetime import datetime
import hashlib
import json
from pathlib import Path, PurePosixPath
import re
import subprocess
import sys


ROOT = Path(__file__).resolve().parents[1]
HISTORY = ROOT / "docs/evidence/chat-history.json"
PRIVATE = ROOT / "docs/evidence/private"
SENSITIVE = {
    "疑似密钥": (
        r"-----BEGIN [A-Z ]*PRIVATE KEY-----|https?://[^/\s:@]+:[^/\s@]+@"
        r"|(?<![\w])(?:sk-(?:proj-|ant-)?|gh[pousr]_|github_pat_|xox[baprs]-|AKIA)[\w-]{16,}"
    ),
    "不透明加密载荷": r"\bgAAAA[A-Za-z0-9_-]{64,}={0,2}",
    "旧版正文替换标记": r"\u5df2\u8131\u654f",
}
IMAGE_HEADERS = {
    "image/png": b"\x89PNG\r\n\x1a\n",
    "image/jpeg": b"\xff\xd8\xff",
    "image/gif": b"GIF8",
    "image/webp": b"RIFF",
}


def unique_object(pairs):
    value = {}
    for key, item in pairs:
        if key in value:
            raise ValueError("JSON 对象有重复键")
        value[key] = item
    return value


def read_json(path):
    return json.loads(path.read_text(encoding="utf-8"), object_pairs_hook=unique_object)


def strings(value, path="$"):
    if isinstance(value, dict):
        for key, item in value.items():
            yield from strings(item, f"{path}.{key}")
    elif isinstance(value, list):
        for index, item in enumerate(value):
            yield from strings(item, f"{path}[{index}]")
    elif isinstance(value, str):
        yield path, value


def path_in_root(value, base):
    if not isinstance(value, str) or "\\" in value or ":" in value:
        return None
    path = PurePosixPath(value)
    if path.is_absolute() or ".." in path.parts:
        return None
    absolute = (ROOT / path).resolve()
    return absolute if absolute.is_relative_to(base.resolve()) else None


def check_time(value, context, errors):
    if value is None:
        return
    try:
        if datetime.fromisoformat(value).utcoffset() is None:
            raise ValueError
    except (TypeError, ValueError):
        errors.append(f"{context}: 时间应包含时区")


def check_image(value):
    try:
        scheme, payload = value.split(",", 1)
        media, encoding = scheme.removeprefix("data:").split(";", 1)
        return (
            scheme.startswith("data:") and encoding == "base64"
            and media in IMAGE_HEADERS
            and base64.b64decode(payload, validate=True).startswith(IMAGE_HEADERS[media])
        )
    except (AttributeError, ValueError, binascii.Error):
        return False


def index(rows, context, errors):
    result = {}
    for row in rows:
        key = row["id"]
        if not isinstance(key, str) or not key or key in result:
            errors.append(f"{context}: 缺少有效或唯一的 ID")
        result[key] = row
    return result


def git_objects(commits, errors):
    if not commits:
        return
    result = subprocess.run(
        ["git", "cat-file", "--batch-check=%(objectname) %(objecttype)"],
        input="\n".join(commits) + "\n", cwd=ROOT, text=True, capture_output=True, check=True,
    )
    found = set(result.stdout.splitlines())
    for sha in commits:
        if f"{sha} commit" not in found:
            errors.append(f"Git 对象无法核实: {sha}")


def validate(history, verify_local):
    errors = []
    if history.get("schema_version") != 1 or history.get("project") != "ThesisPilot":
        errors.append("归档版本或项目名称无效")
    for location, value in strings(history):
        if location.endswith(".data_url"):
            if not check_image(value):
                errors.append(f"{location}: 原始图片附件格式无效")
            continue
        for category, pattern in SENSITIVE.items():
            if re.search(pattern, value):
                errors.append(f"{location}: 发现{category}")

    tracks = index(history["development_tracks"], "开发线路", errors)
    agents = index(history["agents"], "智能体", errors)
    runs = index(history["agent_runs"], "智能体运行", errors)
    conversations = index(history["conversations"], "主聊天", errors)
    chains = index(history["prompt_chains"], "核心链", errors)
    if runs.keys() & conversations.keys():
        errors.append("主聊天与运行 ID 重复")
    records = conversations | runs
    turns = {
        sid: index(record["turns"], f"{sid} 的轮次", errors)
        for sid, record in records.items()
    }
    exclusions = PRIVATE / "chat-exclusions.json"
    if verify_local and exclusions.is_file():
        excluded = read_json(exclusions)
        repo_strings = {value for _, value in strings(history)}
        if any(key in value for _, key in strings(excluded) for value in repo_strings if key):
            errors.append("仓库归档包含本机明确排除的标识")

    def check_tracks(row, context):
        if not row["tracks"] or not set(row["tracks"]) <= tracks.keys():
            errors.append(f"{context}: 开发线路引用无效")

    def check_artifacts(row, context):
        for path in row.get("related_artifacts", []):
            target = path_in_root(path, ROOT)
            if target is None or not target.is_file():
                errors.append(f"{context}: 关联证据文件不存在")

    for aid, agent in agents.items():
        check_tracks(agent, aid)
        check_artifacts(agent, aid)

    commit_ids = set()
    counts = Counter()
    for sid, record in records.items():
        check_time(record["started_at"], sid, errors)
        source = record.get("source")
        source_lines = []
        if source:
            path = path_in_root(source["path"], PRIVATE)
            if path is None or not re.fullmatch(r"[a-f0-9]{64}", source["sha256"]):
                errors.append(f"{sid}: 本机来源路径或 SHA-256 无效")
            elif verify_local:
                raw = path.read_bytes() if path.is_file() else None
                if raw is None or hashlib.sha256(raw).hexdigest() != source["sha256"]:
                    errors.append(f"{sid}: 本机原件缺失或哈希不符")
                elif source["kind"].startswith("codex_rollout"):
                    source_lines = raw.splitlines()

        def check_line(line, label, require=None):
            if type(line) is not int or line < 1:
                errors.append(f"{sid}: {label}行号无效")
            elif source_lines and (line > len(source_lines) or require and require not in source_lines[line - 1]):
                errors.append(f"{sid}: 无法在本地原件定位{label}")

        if sid in runs:
            aid = record["agent_id"]
            parent = record.get("parent_thread_id")
            if aid not in agents or parent is not None and (parent not in records or parent == sid):
                errors.append(f"{sid}: 智能体定义或父聊天引用无效")
            for dispatch in record.get("dispatches", []):
                check_time(dispatch["at"], f"{sid} 派发", errors)
                turn_id = dispatch.get("parent_turn_id")
                if turn_id not in turns.get(parent, {}) or sid not in turns[parent][turn_id].get("agent_run_ids", []):
                    errors.append(f"{sid}: 派发的父轮次引用无效")
                if verify_local and parent in records:
                    parent_source = records[parent].get("source")
                    if parent_source and parent_source["kind"].startswith("codex_rollout"):
                        parent_path = path_in_root(parent_source["path"], PRIVATE)
                        if parent_path and parent_path.is_file():
                            lines = parent_path.read_bytes().splitlines()
                            number = dispatch.get("source_line", 0)
                            if not 0 < number <= len(lines) or dispatch["kind"].encode() not in lines[number - 1]:
                                errors.append(f"{sid}: 无法在父聊天原件定位派发")

        first_user = True
        for tid, turn in turns[sid].items():
            check_tracks(turn, tid)
            check_time(turn["started_at"], tid, errors)
            check_time(turn["completed_at"], tid, errors)
            agents_in_turn = turn.get("agent_run_ids", [])
            if len(agents_in_turn) != len(set(agents_in_turn)) or any(
                aid not in runs or runs[aid].get("parent_thread_id") != sid for aid in agents_in_turn
            ):
                errors.append(f"{tid}: 智能体运行引用无效")
            for key in ("messages", "execution"):
                rows = turn[key]
                index(rows, f"{tid} 的 {key}", errors)
                ordinals = [item["ordinal"] for item in rows]
                if ordinals != sorted(ordinals) or len(ordinals) != len(set(ordinals)):
                    errors.append(f"{tid}: {key} 顺序无效")
                for item in rows:
                    check_time(item["at"], item["id"], errors)
            first_in_turn = True
            for item in turn["messages"]:
                counts[item["role"]] += 1
                if item["role"] == "user":
                    expected = "conversation_start" if first_user else "turn_start" if first_in_turn else "interjection"
                    if item["kind"] != expected or not item["parts"]:
                        errors.append(f"{tid}: 用户消息的首条、轮首或插话标记无效")
                    first_user, first_in_turn = False, False
                elif item["role"] != "assistant" or not isinstance(item.get("content"), str):
                    errors.append(f"{tid}: AI 回复结构无效")
            for link in turn["commits"]:
                sha = link["sha"]
                if not re.fullmatch(r"[a-f0-9]{40}", sha):
                    errors.append(f"{tid}: 提交 SHA 不完整")
                else:
                    commit_ids.add(sha)
                if link.get("source_line") is not None:
                    check_line(link["source_line"], "提交", sha[:7].encode())
                elif not ((path := path_in_root(link.get("evidence_path"), ROOT)) and path.is_file()):
                    errors.append(f"{tid}: 提交需要原件定位或已归档证据")

    for cid, chain in chains.items():
        check_artifacts(chain, cid)
        for reference in chain["turns"]:
            if reference["turn_id"] not in turns.get(reference["thread_id"], {}):
                errors.append(f"{cid}: 核心链轮次引用无效")
        references = {(ref["thread_id"], ref["turn_id"]) for ref in chain["turns"]}
        for step in chain.get("evidence", []):
            if reference := step.get("turn"):
                key = (reference["thread_id"], reference["turn_id"])
                if key not in references or key[1] not in turns.get(key[0], {}):
                    errors.append(f"{cid}: 证据轮次引用无效")
                elif not set(step.get("message_ids", ())) <= {
                    event["id"] for event in turns[key[0]][key[1]]["messages"]
                }:
                    errors.append(f"{cid}: 证据消息引用无效")
            elif step.get("message_ids"):
                errors.append(f"{cid}: 证据消息缺少父轮次")
            if path := step.get("document"):
                target = path_in_root(path, ROOT)
                if target is None or not target.is_file():
                    errors.append(f"{cid}: 证据文档不存在")
            for sha in step.get("commits", []):
                if not re.fullmatch(r"[a-f0-9]{40}", sha):
                    errors.append(f"{cid}: 证据提交 SHA 不完整")
                else:
                    commit_ids.add(sha)
        if chain["status"] == "verified":
            if chain.get("gap") or not chain["turns"]:
                errors.append(f"{cid}: 核心链状态与缺口冲突")
        elif not chain.get("gap"):
            errors.append(f"{cid}: 待补核心链未注明缺口")

    git_objects(sorted(commit_ids), errors)
    return errors, counts


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--verify-local-sources", action="store_true", help="核对本机受控原件和排除标识")
    args = parser.parse_args()
    try:
        history = read_json(HISTORY)
        errors, counts = validate(history, args.verify_local_sources)
    except (KeyError, TypeError, ValueError, OSError, subprocess.CalledProcessError):
        print("FAIL: 聊天 JSON、来源文件或 Git 读取失败。", file=sys.stderr)
        return 1
    if errors:
        for error in errors:
            print(f"FAIL: {error}", file=sys.stderr)
        return 1
    print(
        f"PASS: {len(history['conversations'])} 个主聊天，{len(history['agent_runs'])} 次子代理运行，"
        f"{counts['user']} 条用户消息，{counts['assistant']} 条 AI 消息。"
    )
    if args.verify_local_sources:
        print("PASS: 本机原件哈希、派发和提交定位、排除标识。")
    return 0


if __name__ == "__main__":
    sys.exit(main())
