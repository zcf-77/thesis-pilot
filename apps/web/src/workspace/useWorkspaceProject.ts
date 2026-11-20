import { computed, onScopeDispose, shallowRef, ref, watch, type Ref } from "vue";
import type { ProjectRead, ProjectService } from "../services/index.ts";
import { ApiError, asApiError } from "../services/errors.ts";
import { isUuid } from "../services/validation.ts";
import { readAll } from "./projects/flowCatalog.ts";

export function useWorkspaceProject(projects: ProjectService, workspaceKey: string, routeProjectId: Ref<string | undefined>) {
  const storageKey = `thesispilot.workspace.project.v1:${workspaceKey}`;
  const remembered = ref<string>();
  try {
    const stored = localStorage.getItem(storageKey);
    if (isUuid(stored)) remembered.value = stored.toLowerCase();
  } catch {
    // Project routes remain usable when browser storage is unavailable.
  }
  const requestedId = computed(() => routeProjectId.value ?? remembered.value);
  const snapshot = shallowRef<ProjectRead>();
  const project = computed(() => (snapshot.value?.id.toLowerCase() === requestedId.value ? snapshot.value : undefined));
  const status = ref<"idle" | "loading" | "ready" | "missing" | "failed">("idle");
  const refresh = ref(0);

  watch(
    [routeProjectId, refresh],
    async ([explicitId, revision], previous, onCleanup) => {
      const id = explicitId ?? remembered.value;
      if (revision === previous[1] && snapshot.value && snapshot.value.id.toLowerCase() === id && (explicitId || !snapshot.value.archived)) return;
      const request = new AbortController();
      onCleanup(() => request.abort());
      snapshot.value = undefined;
      status.value = "loading";
      try {
        let result: ProjectRead | undefined;
        if (id) {
          try {
            result = await projects.get(id, request.signal);
            if (result.id.toLowerCase() !== id) throw new ApiError("INVALID_RESPONSE");
          } catch (error) {
            if (explicitId || asApiError(error).code !== "PROJECT_NOT_FOUND") throw error;
          }
        }
        if (request.signal.aborted) return;
        if (!explicitId && (!result || result.archived)) {
          const available = await readAll((query) => projects.list(query, request.signal), request.signal);
          if (request.signal.aborted) return;
          result = available
            .filter((item) => !item.archived)
            .sort((left, right) => Date.parse(right.updated_at) - Date.parse(left.updated_at) || left.id.localeCompare(right.id))[0];
        }
        if (!result) {
          remembered.value = undefined;
          try {
            localStorage.removeItem(storageKey);
          } catch {
            // The empty directory remains accessible when browser storage is unavailable.
          }
          status.value = "idle";
          return;
        }
        snapshot.value = result;
        status.value = "ready";
        if (!result.archived) {
          remembered.value = result.id.toLowerCase();
          try {
            localStorage.setItem(storageKey, remembered.value);
          } catch {
            // The current project is still available for this visit.
          }
        }
      } catch (error) {
        if (request.signal.aborted) return;
        status.value = asApiError(error).code === "PROJECT_NOT_FOUND" ? "missing" : "failed";
      }
    },
    { immediate: true },
  );

  let quiet: AbortController | undefined;
  /** Re-read the loaded project in place; the current snapshot stays mounted and only a newer version replaces it. */
  async function sync() {
    const current = snapshot.value;
    const id = requestedId.value;
    if (!current || status.value !== "ready" || current.id.toLowerCase() !== id) return;
    quiet?.abort();
    const request = new AbortController();
    quiet = request;
    try {
      const result = await projects.get(id, request.signal);
      if (request.signal.aborted || snapshot.value !== current || requestedId.value !== id || result.id.toLowerCase() !== id) return;
      if (result.version > current.version) snapshot.value = result;
    } catch {
      // A failed background read keeps the last confirmed snapshot; page actions still report their own errors.
    } finally {
      if (quiet === request) quiet = undefined;
    }
  }
  watch(requestedId, () => quiet?.abort());
  onScopeDispose(() => quiet?.abort());

  /** Accept a newer server snapshot of the open project without remounting its page. */
  function replace(next: ProjectRead) {
    const current = snapshot.value;
    if (current && current.id.toLowerCase() === next.id.toLowerCase() && next.version > current.version) snapshot.value = next;
  }

  return { project, status, requestedId, reload: () => refresh.value++, sync, replace };
}

export async function findWorkspaceProjects(projects: ProjectService, search: string, signal: AbortSignal): Promise<ProjectRead[]> {
  const normalized = search.trim().toLocaleLowerCase();
  if (!normalized) return [];
  const matches = new Map<string, ProjectRead>();
  const limit = 100;
  let offset = 0;
  for (;;) {
    const page = await projects.list({ offset, limit }, signal);
    if (signal.aborted) return [];
    if (page.offset !== offset || page.items.length > limit) throw new ApiError("INVALID_RESPONSE");
    for (const row of page.items) {
      if (row.name.toLocaleLowerCase().includes(normalized)) matches.set(row.id, row);
    }
    offset += page.items.length;
    if (!page.items.length || offset >= page.total) return [...matches.values()];
  }
}
