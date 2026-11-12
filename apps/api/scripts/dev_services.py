"""Own isolated Linux PostgreSQL/Redis processes without installing system services."""

import argparse
import json
import os
import secrets
import select
import shutil
import signal
import socket
import subprocess
import sys
import tempfile
import time
from pathlib import Path
from typing import Any

MARKER = "thesis-pilot-dev-services-v1"
DATABASES = ("thesis_pilot_dev", "thesis_pilot_test")


class RuntimeFailure(Exception):
    pass


def private_write(path: Path, value: str) -> None:
    descriptor, temporary = tempfile.mkstemp(prefix=".tp-", dir=path.parent)
    try:
        with os.fdopen(descriptor, "w", encoding="utf-8") as output:
            output.write(value)
        os.replace(temporary, path)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def save(root: Path, state: dict[str, Any]) -> None:
    private_write(root / "runtime.json", json.dumps(state, indent=2) + "\n")


def executable(directory: str | None, name: str) -> str:
    located = str(Path(directory) / name) if directory else shutil.which(name)
    if not located or not Path(located).is_file() or not os.access(located, os.X_OK):
        raise RuntimeFailure(f"找不到可执行文件 {name}；请指定对应的 --postgres-bin/--redis-bin。")
    # Debian Redis uses argv[0] to select server/CLI mode through symlinked entry points.
    return str(Path(located).absolute())


def load(root: Path) -> dict[str, Any]:
    metadata = root / "runtime.json"
    if root.is_symlink() or metadata.is_symlink() or not metadata.is_file():
        raise RuntimeFailure("运行目录没有本脚本的有效状态；拒绝接管或覆盖。")
    if root.stat().st_mode & 0o077 or metadata.stat().st_mode & 0o077:
        raise RuntimeFailure("运行目录和 runtime.json 必须仅其所有者可访问。")
    state = json.loads(metadata.read_text(encoding="utf-8"))
    if state.get("owner") != MARKER or state.get("runtime_dir") != str(root):
        raise RuntimeFailure("运行目录登记不匹配；拒绝接管。")
    if os.geteuid() not in {0, state["invoking_uid"]}:
        raise RuntimeFailure("必须由创建该运行目录的用户或 root 操作。")
    return state


def environment(state: dict[str, Any]) -> dict[str, str]:
    result = dict(os.environ)
    libraries = state["library_dirs"]
    if libraries:
        result["LD_LIBRARY_PATH"] = ":".join(libraries)
    return result


def run(
    command: list[str],
    state: dict[str, Any],
    *,
    as_postgres: bool = False,
    password: bool = False,
) -> str:
    env = environment(state)
    if password:
        env["PGPASSWORD"] = state["database_password"]
    label = Path(command[0]).name
    if as_postgres and os.geteuid() == 0:
        command = ["runuser", "-u", state["postgres_user"], "--", *command]
        if state["library_dirs"]:
            command[4:4] = ["env", "LD_LIBRARY_PATH=" + env["LD_LIBRARY_PATH"]]
    completed = subprocess.run(command, env=env, text=True, capture_output=True, timeout=45)
    if completed.returncode:
        # Subprocess output can contain service configuration. Keep credentials local.
        diagnostic = completed.stdout + completed.stderr
        for field in ("database_password", "api_token"):
            diagnostic = diagnostic.replace(state[field], "[redacted]")
        private_write(Path(state["runtime_dir"]) / "last-error.log", diagnostic)
        raise RuntimeFailure(
            f"{label} 失败，退出码 {completed.returncode}；检查运行目录中的服务日志。"
        )
    return completed.stdout.strip()


def initialize(args: argparse.Namespace, root: Path) -> dict[str, Any]:
    import pwd

    binaries = {
        name: executable(args.postgres_bin, name)
        for name in ("initdb", "pg_ctl", "postgres", "psql")
    }
    binaries["redis-server"] = executable(args.redis_bin, "redis-server")
    binaries["redis-cli"] = executable(args.redis_bin, "redis-cli")
    if os.geteuid() == 0:
        if not shutil.which("runuser"):
            raise RuntimeFailure("root 运行需要现有 runuser 命令和 postgres 用户。")
        try:
            account = pwd.getpwnam("postgres")
        except KeyError:
            raise RuntimeFailure(
                "root 运行需要已存在的 postgres 用户；本脚本不会创建账户。"
            ) from None
    else:
        account = pwd.getpwuid(os.geteuid())
    libraries = [str(Path(value).resolve(strict=True)) for value in args.library_dir]
    if any(not Path(value).is_dir() for value in libraries):
        raise RuntimeFailure("--library-dir 必须为已有目录。")
    root.mkdir(mode=0o700)
    if os.geteuid() == 0:
        os.chown(root, account.pw_uid, account.pw_gid)
    state: dict[str, Any] = {
        "owner": MARKER,
        "runtime_dir": str(root),
        "invoking_uid": os.geteuid(),
        "postgres_user": account.pw_name,
        "postgres_uid": account.pw_uid,
        "postgres_gid": account.pw_gid,
        "postgres_port": args.postgres_port or 15432,
        "redis_port": args.redis_port or 16379,
        "binaries": binaries,
        "library_dirs": libraries,
        "database_password": secrets.token_urlsafe(32),
        "api_token": secrets.token_urlsafe(32),
        "cluster_initialized": False,
        "pids": {},
    }
    save(root, state)
    return state


def require_owned(root: Path, state: dict[str, Any], service: str) -> int | None:
    pid = state["pids"].get(service)
    if pid is None:
        return None
    if not isinstance(pid, int) or pid <= 1:
        raise RuntimeFailure(f"{service} PID 登记无效。")
    process = Path(f"/proc/{pid}")
    if not process.exists():
        return None
    if service == "postgres":
        pidfile = root / "postgres" / "postmaster.pid"
        expected_exe = state["binaries"]["postgres"]
        lines = pidfile.read_text(encoding="utf-8").splitlines() if pidfile.is_file() else []
        correct_data = len(lines) > 1 and lines[1] == str(root / "postgres")
        correct_uid = process.stat().st_uid == state["postgres_uid"]
    else:
        pidfile = root / "redis.pid"
        expected_exe = state["binaries"]["redis-server"]
        lines = pidfile.read_text(encoding="utf-8").splitlines() if pidfile.is_file() else []
        correct_data = (process / "cwd").resolve() == root / "redis"
        correct_uid = process.stat().st_uid == state["invoking_uid"]
    if (
        not lines
        or lines[0] != str(pid)
        or (process / "exe").resolve() != Path(expected_exe).resolve()
        or not correct_data
        or not correct_uid
    ):
        raise RuntimeFailure(f"{service} 进程归属核验失败；拒绝操作 PID {pid}。")
    return pid


def port_available(port: int) -> None:
    with socket.socket() as probe:
        try:
            probe.bind(("127.0.0.1", port))
        except OSError:
            raise RuntimeFailure(f"端口 {port} 已占用；不会接管或停止占用者。") from None


def templates(root: Path, state: dict[str, Any]) -> None:
    connection = (
        "postgresql+psycopg://thesis_pilot:"
        f"{state['database_password']}@127.0.0.1:{state['postgres_port']}/"
    )
    redis = f"redis://127.0.0.1:{state['redis_port']}/"
    private_write(
        root / "api.env",
        "TP_ENVIRONMENT=development\n"
        f"TP_DATABASE_URL={connection}{DATABASES[0]}\n"
        f"TP_REDIS_URL={redis}0\n"
        f"TP_API_TOKEN={state['api_token']}\n"
        "TP_CORS_ORIGINS='[\"http://127.0.0.1:18744\"]'\n"
        "TP_WORKER_LEASE_SECONDS=60\n",
    )
    private_write(
        root / "test.env",
        f"TP_TEST_DATABASE_URL={connection}{DATABASES[1]}\nTP_TEST_REDIS_URL={redis}15\n",
    )


def start(root: Path, state: dict[str, Any]) -> None:
    for name in ("redis-server", "redis-cli"):
        if Path(state["binaries"][name]).name != name:
            raise RuntimeFailure(
                "已有状态中的 Redis 入口已被旧版脚本解析；请核实私有状态后修正入口，"
                "或安全停止现有服务后使用新的运行目录。"
            )
    pg_running = require_owned(root, state, "postgres")
    redis_running = require_owned(root, state, "redis")
    for service, running in (("postgres", pg_running), ("redis", redis_running)):
        if not running:
            port_available(state[f"{service}_port"])
    binaries = state["binaries"]
    data = root / "postgres"
    if not state["cluster_initialized"]:
        if data.exists():
            raise RuntimeFailure("发现未完成初始化的数据目录；保留现场，拒绝覆盖。")
        descriptor, temporary = tempfile.mkstemp(prefix=".pg-password-", dir=root)
        password_file = Path(temporary)
        try:
            with os.fdopen(descriptor, "w", encoding="utf-8") as output:
                output.write(state["database_password"] + "\n")
            if os.geteuid() == 0:
                os.chown(password_file, state["postgres_uid"], state["postgres_gid"])
            run(
                [
                    binaries["initdb"],
                    "-D",
                    str(data),
                    "--username=thesis_pilot",
                    "--encoding=UTF8",
                    "--locale=C.UTF-8",
                    "--auth-local=scram-sha-256",
                    "--auth-host=scram-sha-256",
                    "--pwfile=" + str(password_file),
                ],
                state,
                as_postgres=True,
            )
        finally:
            password_file.unlink(missing_ok=True)
        socket_directory = str(root).replace("'", "''")
        with (data / "postgresql.conf").open("a", encoding="utf-8") as output:
            output.write(
                "\nlisten_addresses = '127.0.0.1'\n"
                f"port = {state['postgres_port']}\n"
                f"unix_socket_directories = '{socket_directory}'\n"
            )
        state["cluster_initialized"] = True
        save(root, state)
    if not pg_running:
        run(
            [
                binaries["pg_ctl"],
                "-D",
                str(data),
                "-l",
                str(root / "postgres.log"),
                "-w",
                "-t",
                "30",
                "start",
            ],
            state,
            as_postgres=True,
        )
        state["pids"]["postgres"] = int((data / "postmaster.pid").read_text().splitlines()[0])
        save(root, state)
        require_owned(root, state, "postgres")
    psql = [
        binaries["psql"],
        "-h",
        "127.0.0.1",
        "-p",
        str(state["postgres_port"]),
        "-U",
        "thesis_pilot",
        "-d",
        "postgres",
        "-v",
        "ON_ERROR_STOP=1",
        "--no-psqlrc",
        "--no-password",
    ]
    for database in DATABASES:
        exists = run(
            [*psql, "-tAc", f"SELECT 1 FROM pg_database WHERE datname='{database}'"],
            state,
            password=True,
        )
        if not exists:
            run([*psql, "-c", f"CREATE DATABASE {database}"], state, password=True)
    if not redis_running:
        (root / "redis").mkdir(mode=0o700, exist_ok=True)

        def quote(path: Path) -> str:
            return '"' + str(path).replace("\\", "\\\\").replace('"', '\\"') + '"'

        private_write(
            root / "redis.conf",
            "bind 127.0.0.1\nprotected-mode yes\n"
            f"port {state['redis_port']}\ndaemonize yes\n"
            f"pidfile {quote(root / 'redis.pid')}\n"
            f"logfile {quote(root / 'redis.log')}\n"
            f"dir {quote(root / 'redis')}\nappendonly yes\n",
        )
        run([binaries["redis-server"], str(root / "redis.conf")], state)
        deadline = time.monotonic() + 10
        while not (root / "redis.pid").is_file():
            if time.monotonic() >= deadline:
                raise RuntimeFailure("Redis 未写入 PID；检查运行目录中的 redis.log。")
            time.sleep(0.1)
        state["pids"]["redis"] = int((root / "redis.pid").read_text().strip())
        save(root, state)
        require_owned(root, state, "redis")
    pong = run(
        [binaries["redis-cli"], "-h", "127.0.0.1", "-p", str(state["redis_port"]), "ping"],
        state,
    )
    if pong != "PONG":
        raise RuntimeFailure("Redis 未就绪；检查运行目录中的 redis.log。")
    templates(root, state)
    print("独立 PostgreSQL/Redis 已启动；连接配置保存在运行目录的 api.env、test.env。")


def stop(root: Path, state: dict[str, Any]) -> None:
    # Validate both owners before stopping either process. Never select targets by port.
    targets = [(service, require_owned(root, state, service)) for service in ("redis", "postgres")]
    for service, pid in targets:
        if pid is None:
            continue
        descriptor = os.pidfd_open(pid)
        try:
            require_owned(root, state, service)
            signal.pidfd_send_signal(
                descriptor, signal.SIGINT if service == "postgres" else signal.SIGTERM
            )
            poller = select.poll()
            poller.register(descriptor, select.POLLIN)
            if not poller.poll(30_000):
                raise RuntimeFailure(f"{service} 未在 30 秒内停止；保留状态和数据。")
        finally:
            os.close(descriptor)
        state["pids"].pop(service, None)
        save(root, state)
    print("本运行目录登记的服务已停止，数据与配置保留。")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=("start", "status", "stop"))
    parser.add_argument("--runtime-dir", required=True)
    parser.add_argument("--postgres-bin", help="Directory containing initdb/pg_ctl/postgres/psql")
    parser.add_argument("--redis-bin", help="Directory containing redis-server/redis-cli")
    parser.add_argument("--library-dir", action="append", default=[])
    parser.add_argument("--postgres-port", type=int)
    parser.add_argument("--redis-port", type=int)
    args = parser.parse_args()
    if not sys.platform.startswith("linux"):
        parser.error("本地服务脚本仅支持 Linux；Windows 请通过 WSL 执行。")
    if not callable(getattr(os, "pidfd_open", None)) or not callable(
        getattr(signal, "pidfd_send_signal", None)
    ):
        parser.error(
            "当前 Python 未提供 pidfd 安全进程接口；请改用发行版 Python："
            "/usr/bin/python3 scripts/dev_services.py，并保留原命令及参数。"
        )
    for port in (args.postgres_port, args.redis_port):
        if port is not None and not 1024 <= port <= 65535:
            parser.error("端口必须在 1024—65535 之间。")
    raw_root = Path(args.runtime_dir).absolute()
    if raw_root.is_symlink() or any(character in str(raw_root) for character in "\r\n"):
        parser.error("运行目录不得为符号链接或包含换行。")
    root = raw_root.resolve()
    try:
        if root.exists():
            state = load(root)
        elif args.command == "start":
            state = initialize(args, root)
        else:
            raise RuntimeFailure("指定运行目录不存在。")
        import fcntl

        with (root / "control.lock").open("a") as lock:
            os.chmod(root / "control.lock", 0o600)
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            # Re-read after acquiring the lock so concurrent callers cannot use stale PIDs.
            state = load(root)
            for service in ("postgres", "redis"):
                provided = getattr(args, f"{service}_port")
                if provided is not None and provided != state[f"{service}_port"]:
                    raise RuntimeFailure("端口与已有运行目录登记不一致；请选择新的运行目录。")
            if state["postgres_port"] == state["redis_port"]:
                raise RuntimeFailure("PostgreSQL 与 Redis 端口不能相同。")
            if args.command == "start":
                start(root, state)
            elif args.command == "stop":
                stop(root, state)
            else:
                for service in ("postgres", "redis"):
                    status = "running" if require_owned(root, state, service) else "stopped"
                    print(f"{service}: {status} (127.0.0.1:{state[f'{service}_port']})")
    except (RuntimeFailure, OSError, ValueError, KeyError, subprocess.TimeoutExpired) as error:
        if isinstance(error, RuntimeFailure):
            print(str(error), file=sys.stderr)
        else:
            print(f"操作失败（{type(error).__name__}）；保留运行目录供检查。", file=sys.stderr)
        raise SystemExit(1) from None


if __name__ == "__main__":
    main()
