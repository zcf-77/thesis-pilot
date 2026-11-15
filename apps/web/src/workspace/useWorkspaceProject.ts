import { computed, shallowRef, ref, watch, type Ref } from "vue";
import type { ProjectRead, ProjectService } from "../services/index.ts";
import { ApiError, asApiError } from "../services/errors.ts";
import { isUuid } from "../services/validation.ts";

export function useWorkspaceProject(projects: ProjectService, workspaceKey: string, routeProjectId: Ref<string | undefined>) {
  const storageKey = `thesispilot.workspace.project.v1:${workspaceKey}`;
  const remembered = ref<string>();
  try {
    const stored = localStorage.getItem(storageKey);
    if (isUuid(stored)) remembered.value = stored;
  } catch {
    // Project routes remain usable when browser storage is unavailable.
  }
  const requestedId = computed(() => routeProjectId.value ?? remembered.value);
  const snapshot = shallowRef<ProjectRead>();
  const project = computed(() => (snapshot.value?.id.toLowerCase() === requestedId.value ? snapshot.value : undefined));
  const status = ref<"idle" | "loading" | "ready" | "missing" | "failed">("idle");
  const refresh = ref(0);

  watch(
    [requestedId, refresh],
    async ([id], _, onCleanup) => {
      snapshot.value = undefined;
      if (!id) {
        status.value = "idle";
        return;
      }

      const request = new AbortController();
      onCleanup(() => request.abort());
      status.value = "loading";
      try {
        const result = await projects.get(id, request.signal);
        if (request.signal.aborted || requestedId.value !== id) return;
        if (result.id.toLowerCase() !== id) throw new ApiError("INVALID_RESPONSE");
        snapshot.value = result;
        status.value = "ready";
        remembered.value = id;
        try {
          localStorage.setItem(storageKey, id);
        } catch {
          // The current project is still available for this visit.
        }
      } catch (error) {
        if (request.signal.aborted || requestedId.value !== id) return;
        status.value = asApiError(error).code === "PROJECT_NOT_FOUND" ? "missing" : "failed";
      }
    },
    { immediate: true },
  );

  return { project, status, reload: () => refresh.value++ };
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
