import { onMounted, onScopeDispose, ref, shallowRef } from "vue";
import { asApiError } from "@/services/errors";
import { workspaceAccess, type WorkspaceProfile, type WorkspaceSession } from "@/services/workspace";

const SESSION_SIGNAL = "thesispilot.workspace.session.v1";
const SESSION_REQUIRED = "WORKSPACE_SESSION_REQUIRED";
const POLL_MS = 30_000;

export function useWorkspaceSession(access: typeof workspaceAccess = workspaceAccess) {
  const session = shallowRef<WorkspaceSession>();
  const gate = ref<"checking" | "locked" | "failed" | "active">("checking");
  const pending = ref<"open" | "close">();
  const message = ref("");
  const exitError = ref("");
  let check: AbortController | undefined;
  let command: AbortController | undefined;
  let expiry: ReturnType<typeof setTimeout> | undefined;
  let poll: ReturnType<typeof setInterval> | undefined;
  let channel: BroadcastChannel | undefined;

  function applyProfile(profile: WorkspaceProfile) {
    const active = session.value;
    if (active && profile.id === active.profile.id && profile.version >= active.profile.version) session.value = { ...active, profile };
  }

  function observeExpiry() {
    clearTimeout(expiry);
    if (!session.value) return;
    const remaining = Date.parse(session.value.expires_at) - Date.now();
    if (remaining <= 0) {
      invalidate("工作区会话已到期，请重新解锁。");
      return;
    }
    expiry = setTimeout(observeExpiry, Math.min(remaining, 2_147_483_647));
  }

  function activate(next: WorkspaceSession) {
    const active = session.value;
    const profile = active && next.profile.id === active.profile.id && active.profile.version > next.profile.version ? active.profile : next.profile;
    session.value = { ...next, profile };
    gate.value = "active";
    message.value = "";
    observeExpiry();
  }

  function invalidate(reason: string) {
    check?.abort();
    check = undefined;
    command?.abort();
    command = undefined;
    clearTimeout(expiry);
    session.value = undefined;
    gate.value = "locked";
    pending.value = undefined;
    message.value = reason;
    exitError.value = "";
  }

  async function verify() {
    if (check || command) return;
    const request = new AbortController();
    check = request;
    if (!session.value) gate.value = "checking";
    try {
      const result = await access.getSession(request.signal);
      if (check === request) activate(result);
    } catch (error) {
      if (check !== request) return;
      const problem = asApiError(error);
      if (problem.code === SESSION_REQUIRED) invalidate(session.value ? "工作区会话已失效，请重新解锁。" : "");
      else if (!session.value) {
        gate.value = "failed";
        message.value = "无法检查工作区会话，请检查服务连接后重试。";
      }
    } finally {
      if (check === request) check = undefined;
    }
  }

  async function open(accessKey: string) {
    if (gate.value !== "locked" || command) return;
    const request = new AbortController();
    command = request;
    pending.value = "open";
    message.value = "";
    try {
      const next = await access.openSession(accessKey, request.signal);
      if (command === request) activate(next);
    } catch (error) {
      if (command !== request) return;
      const problem = asApiError(error);
      if (problem.code === "WORKSPACE_ACCESS_DENIED") message.value = "访问口令有误，请重新输入。";
      else message.value = "未能确认解锁结果。请检查服务连接后重试。";
    } finally {
      if (command === request) {
        command = undefined;
        pending.value = undefined;
      }
    }
  }

  function publishExit() {
    if (channel) channel.postMessage("signed-out");
    else {
      try {
        localStorage.setItem(SESSION_SIGNAL, crypto.randomUUID());
      } catch {
        // The next server check still observes the revoked session.
      }
    }
  }

  async function close() {
    if (!session.value || command) return;
    check?.abort();
    check = undefined;
    const request = new AbortController();
    command = request;
    pending.value = "close";
    exitError.value = "";
    try {
      await access.closeSession(request.signal);
      if (command !== request) return;
      publishExit();
      invalidate("已退出工作区。");
    } catch (error) {
      if (command !== request) return;
      if (asApiError(error).code === SESSION_REQUIRED) {
        publishExit();
        invalidate("工作区会话已失效，请重新解锁。");
      } else {
        exitError.value = "未能确认退出。请检查服务连接后重新退出。";
      }
    } finally {
      if (command === request) {
        command = undefined;
        pending.value = undefined;
      }
    }
  }

  function onRemoteExit() {
    if (session.value || gate.value === "checking") invalidate("工作区已在另一个标签页退出。");
  }

  function onStorage(event: StorageEvent) {
    if (event.key === SESSION_SIGNAL && event.newValue) onRemoteExit();
  }

  function onRequired() {
    if (session.value) invalidate("工作区会话已失效，请重新解锁。");
  }

  function checkWhenVisible() {
    if (document.visibilityState === "hidden" || gate.value !== "active") return;
    observeExpiry();
    if (session.value) void verify();
  }

  onMounted(() => {
    if (typeof BroadcastChannel === "function") {
      channel = new BroadcastChannel(SESSION_SIGNAL);
      channel.onmessage = (event: MessageEvent<unknown>) => {
        if (event.data === "signed-out") onRemoteExit();
      };
    }
    window.addEventListener("storage", onStorage);
    window.addEventListener("tp:workspace-session-required", onRequired);
    window.addEventListener("focus", checkWhenVisible);
    window.addEventListener("pageshow", checkWhenVisible);
    document.addEventListener("visibilitychange", checkWhenVisible);
    poll = setInterval(checkWhenVisible, POLL_MS);
    void verify();
  });

  onScopeDispose(() => {
    check?.abort();
    check = undefined;
    command?.abort();
    command = undefined;
    clearTimeout(expiry);
    clearInterval(poll);
    channel?.close();
    if (typeof window === "undefined") return;
    window.removeEventListener("storage", onStorage);
    window.removeEventListener("tp:workspace-session-required", onRequired);
    window.removeEventListener("focus", checkWhenVisible);
    window.removeEventListener("pageshow", checkWhenVisible);
    document.removeEventListener("visibilitychange", checkWhenVisible);
  });

  return { session, gate, pending, message, exitError, verify, open, close, applyProfile };
}
