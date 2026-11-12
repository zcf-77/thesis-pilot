"""在普通终端接续只读会话保存的提交；不重写工作文件或既有提交。"""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
import shutil
import subprocess
import sys
from datetime import datetime


class Stop(RuntimeError):
    pass


def git(repo: Path, *args: str) -> str:
    result = subprocess.run(
        ["git", "-C", str(repo), *args], capture_output=True, encoding="utf-8", errors="replace"
    )
    if result.returncode:
        raise Stop(f"Git 操作失败（退出 {result.returncode}）：{' '.join(args)}\n{result.stderr or result.stdout}")
    return result.stdout.strip()


def inspect(repo: Path, source: Path) -> tuple[str, str]:
    if git(repo, "branch", "--show-current") != "main":
        raise Stop("原工作区不在 main，停止；不切换现有检出。")
    if git(source, "branch", "--show-current") != "main":
        raise Stop("提交副本不在 main，停止。")
    if git(source, "status", "--porcelain"):
        raise Stop("提交副本有未提交改动，停止。")
    if git(repo, "diff", "--cached", "--name-only"):
        raise Stop("原工作区有暂存内容，需先审阅；不覆盖现有索引。")
    if git(repo, "remote", "get-url", "origin") != git(source, "remote", "get-url", "origin"):
        raise Stop("原目录与提交副本的 origin 不一致，停止。")
    for workspace in (repo, source):
        metadata = Path(git(workspace, "rev-parse", "--absolute-git-dir"))
        if any((metadata / p).exists() for p in ("MERGE_HEAD", "CHERRY_PICK_HEAD", "rebase-merge", "rebase-apply")):
            raise Stop(f"{workspace} 存在未完成的整合操作，停止。")
    old, tip = git(repo, "rev-parse", "HEAD"), git(source, "rev-parse", "HEAD")
    git(source, "merge-base", "--is-ancestor", old, tip)
    expected = set(git(source, "ls-tree", "-rz", "--name-only", tip).split("\0")) - {""}
    observed = set(git(repo, "ls-files", "--cached", "--others", "--exclude-standard", "-z").split("\0")) - {""}
    for name in expected:
        left, right = repo / name, source / name
        if left.is_symlink() or right.is_symlink() or not left.is_file() or not right.is_file():
            raise Stop(f"文件缺失或为符号链接，停止：{name}")
        if hashlib.sha256(left.read_bytes()).digest() != hashlib.sha256(right.read_bytes()).digest():
            raise Stop(f"存在尚未整理的新改动，停止并保留原文件：{name}")
    extras = sorted(name for name in observed - expected if (repo / name).exists())
    if extras:
        raise Stop("存在提交链以外的新文件，停止：" + ", ".join(extras))
    return old, tip


def attach(repo: Path, source: Path) -> str:
    old, tip = inspect(repo, source)
    metadata = Path(git(repo, "rev-parse", "--absolute-git-dir"))
    # 先实际检查权限；不改 ACL、不提权、不启动会话外的后台进程。
    probe = metadata / "thesispilot-publish-write-probe"
    try:
        with probe.open("xb"):
            pass
        probe.unlink()
    except OSError as exc:
        raise Stop(f"当前进程仍不能写入 Git 元数据。请在电脑普通终端运行本脚本。\n{exc}") from exc
    backup = repo / "work" / ("main-recovery-" + datetime.now().strftime("%Y%m%d-%H%M%S-%f"))
    backup.mkdir(parents=True)
    if (metadata / "index").exists():
        shutil.copy2(metadata / "index", backup / "index.before")
    (backup / "state.json").write_text(json.dumps({"old": old, "target": tip}, indent=2), encoding="utf-8")
    bundle = backup / "main.bundle"
    git(source, "bundle", "create", str(bundle), "main")
    git(repo, "fetch", "--no-tags", str(bundle), "main")
    if git(repo, "rev-parse", "FETCH_HEAD") != tip:
        raise Stop("本地导入结果与目标提交不一致，停止。")
    if inspect(repo, source) != (old, tip):
        raise Stop("核对期间提交发生变化，停止。")
    # 原工作文件与目标逐字节一致；只接回引用和索引，不 checkout/reset/stash 文件。
    git(repo, "update-ref", "refs/heads/main", tip, old)
    git(repo, "read-tree", tip)
    if git(repo, "status", "--porcelain"):
        raise Stop("接回后出现新改动，停止推送；工作文件和恢复包均保留。")
    print(f"已接回原 main：{tip}；原文件未重写；恢复记录：{backup}", flush=True)
    return tip


def publish(repo: Path) -> None:
    git(repo, "fetch", "origin", "--prune")
    base = git(repo, "merge-base", "HEAD", "origin/main")
    remote_changes = git(repo, "diff", "--name-only", base, "origin/main").splitlines()
    sensitive = [p for p in remote_changes if p.startswith("apps/api/migrations/") or p.endswith("core/errors.py")]
    if sensitive:
        raise Stop("远端修改了迁移或错误码，需审阅语义冲突后再推送：" + ", ".join(sensitive))
    print("远端相对共同基线未修改迁移或错误码登记；不代表运行时兼容验收。", flush=True)
    print(git(repo, "rebase", "origin/main") or "rebase 完成。", flush=True)
    # rebase 若引入远端内容，先停止，避免将未经复验的新组合推送。
    if remote_changes:
        raise Stop("已整合远端新内容；请按项目门槛复验后直接执行 git push origin main。")
    git(repo, "diff", "--check")
    if git(repo, "status", "--porcelain"):
        raise Stop("推送前工作区出现改动，停止。")
    print(git(repo, "push", "origin", "main") or "推送命令完成。", flush=True)
    tip = git(repo, "rev-parse", "HEAD")
    remote = git(repo, "ls-remote", "origin", "refs/heads/main").split()
    if not remote or remote[0] != tip:
        raise Stop("尚未确认远端 main 与本地一致，不清理提交副本。")
    git(repo, "fetch", "origin", "--prune")
    refs = git(repo, "for-each-ref", "--format=%(refname)", "refs/heads", "refs/remotes/origin").splitlines()
    for ref in refs:
        git(repo, "merge-base", "--is-ancestor", ref, "main")
    print(f"远端 main 已确认：{tip}；本地及 origin 分支均无 main 以外的提交。", flush=True)
    print("工作树：\n" + git(repo, "worktree", "list"), flush=True)
    visibility = subprocess.run(
        ["gh", "repo", "view", "--json", "visibility"], cwd=repo, capture_output=True, text=True
    )
    if visibility.returncode:
        print("代码已推送；仓库可见性查询失败，未修改可见性。", flush=True)
    else:
        print("仓库可见性：" + visibility.stdout.strip(), flush=True)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check-only", action="store_true", help="仅核对提交与文件，不写入或联网")
    args = parser.parse_args()
    repo = Path(__file__).resolve().parents[1]
    source = repo / "work/main-integration"
    try:
        if args.check_only:
            old, tip = inspect(repo, source)
            print(f"核对通过：原 main {old}，待接回 {tip}；受控文件逐字节一致。")
        else:
            attach(repo, source)
            publish(repo)
        return 0
    except (Stop, OSError) as exc:
        print(f"停止：{exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
