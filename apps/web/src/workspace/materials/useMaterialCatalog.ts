import { computed, onScopeDispose, ref, shallowRef, watch } from "vue";
import type { BackendServices, JobRead } from "../../services/index.ts";
import { asApiError } from "../../services/errors.ts";
import { matchesQuery, materialParseState, tabKind, type MaterialKind, type MaterialTab } from "./materialPresentation.ts";

type Material = Awaited<ReturnType<BackendServices["materials"]["get"]>>;
type MaterialPage = Awaited<ReturnType<BackendServices["materials"]["list"]>>;
type Original = Awaited<ReturnType<BackendServices["materials"]["original"]>>;
type ParseSummary = Awaited<ReturnType<BackendServices["materials"]["parses"]>>["items"][number];
export interface MaterialRowInfo {
  material: Material;
  original?: Original;
  originalTotal?: number;
  parse?: ParseSummary;
  parseTotal?: number;
  job?: JobRead;
  loading: boolean;
  error?: string;
}
export type CountKey = "all" | MaterialKind;
export const PAGE_SIZE = 20;
const JOB_PAGES = 10;

export function jobOriginalId(job: Pick<JobRead, "resource_scope" | "input_snapshot">): string | undefined {
  const scope = job.resource_scope ?? job.input_snapshot;
  return scope && typeof scope === "object" && "original_version_id" in scope && typeof scope.original_version_id === "string"
    ? scope.original_version_id
    : undefined;
}

/** Catalog listing, per-kind totals and row enrichment (current original, newest parse, latest parse task). */
export function useMaterialCatalog(services: BackendServices, projectId: () => string) {
  const tab = ref<MaterialTab>("materials");
  const category = ref<"all" | MaterialKind>("all");
  const includeRemoved = ref(false);
  const query = ref("");
  const page = shallowRef<MaterialPage>();
  const busy = ref(false);
  const error = ref("");
  const offset = ref(0);
  const counts = ref<Partial<Record<CountKey, number>>>({});
  const linkedTotal = ref<number>();
  const countsError = ref("");
  const info = shallowRef(new Map<string, MaterialRowInfo>());
  /** The selected material stays listed while a name filter is applied, since the query also locates text inside it. */
  const pinned = ref<string>();
  const visible = computed(() => (page.value?.items ?? []).filter((item) => item.id === pinned.value || matchesQuery(item.name, query.value)));
  const filtered = computed(() => !!query.value.trim() || (tab.value === "materials" && category.value !== "all"));
  let listRequest: AbortController | undefined;
  let countRequest: AbortController | undefined;
  let enrichRequest: AbortController | undefined;
  let pollTimer: ReturnType<typeof setTimeout> | undefined;
  let disposed = false;

  const listKind = () => (tab.value === "materials" ? (category.value === "all" ? undefined : category.value) : tabKind[tab.value]);

  function setInfo(id: string, patch: Partial<MaterialRowInfo> & { material: Material }) {
    const next = new Map(info.value);
    next.set(id, { loading: false, ...next.get(id), ...patch });
    info.value = next;
  }

  async function load(at = offset.value) {
    listRequest?.abort();
    const controller = new AbortController();
    listRequest = controller;
    offset.value = at;
    busy.value = true;
    error.value = "";
    try {
      const result = await services.materials.list(
        projectId(),
        { offset: at, limit: PAGE_SIZE, kind: listKind(), include_removed: includeRemoved.value },
        controller.signal,
      );
      if (controller.signal.aborted) return;
      if (!result.items.length && at > 0 && result.total > 0) {
        busy.value = false;
        return void load(Math.max(0, Math.floor((result.total - 1) / PAGE_SIZE) * PAGE_SIZE));
      }
      page.value = result;
      void enrich(result.items);
    } catch (problem) {
      if (!controller.signal.aborted) error.value = asApiError(problem).message;
    } finally {
      if (!controller.signal.aborted) busy.value = false;
    }
  }

  async function loadCounts() {
    countRequest?.abort();
    const controller = new AbortController();
    countRequest = controller;
    countsError.value = "";
    const keys: CountKey[] = ["all", "template", "requirements", "literature", "other"];
    try {
      const [linked, ...totals] = await Promise.all([
        services.materials.list(projectId(), { limit: 1 }, controller.signal),
        ...keys.map((key) =>
          services.materials.list(projectId(), { limit: 1, kind: key === "all" ? undefined : key, include_removed: includeRemoved.value }, controller.signal),
        ),
      ]);
      if (controller.signal.aborted) return;
      linkedTotal.value = linked.total;
      counts.value = Object.fromEntries(keys.map((key, index) => [key, totals[index].total]));
    } catch (problem) {
      if (!controller.signal.aborted) countsError.value = asApiError(problem).message;
    }
  }

  async function latestJobs(originalIds: Set<string>, signal: AbortSignal) {
    const found = new Map<string, JobRead>();
    let at = 0;
    for (let index = 0; index < JOB_PAGES && found.size < originalIds.size; index++) {
      const result = await services.jobs.list({ project_id: projectId(), kind: "material_parse", offset: at, limit: 100 }, signal);
      if (signal.aborted) return found;
      for (const job of result.items) {
        const id = jobOriginalId(job);
        if (job.project_id === projectId() && id && originalIds.has(id) && !found.has(id)) found.set(id, job);
      }
      at += result.items.length;
      if (!result.items.length || at >= result.total) break;
    }
    return found;
  }

  async function enrichOne(material: Material, jobs: Map<string, JobRead> | undefined, signal: AbortSignal) {
    const project = projectId();
    try {
      const [originals, parses] = await Promise.all([
        services.materials.originals(project, material.id, { offset: 0, limit: 1 }, signal),
        services.materials.parses(project, material.id, material.current_original_id, { offset: 0, limit: 1 }, signal),
      ]);
      if (signal.aborted) return;
      const original =
        originals.items[0]?.id === material.current_original_id
          ? originals.items[0]
          : await services.materials.original(project, material.id, material.current_original_id, signal);
      if (signal.aborted) return;
      setInfo(material.id, {
        material,
        original,
        originalTotal: originals.total,
        parse: parses.items[0],
        parseTotal: parses.total,
        job: jobs?.get(material.current_original_id) ?? info.value.get(material.id)?.job,
        loading: false,
        error: jobs ? undefined : "任务状态读取失败",
      });
    } catch (problem) {
      if (!signal.aborted) setInfo(material.id, { material, loading: false, error: asApiError(problem).message });
    }
  }

  async function enrich(items: Material[], keepOthers = false) {
    if (!keepOthers) enrichRequest?.abort();
    const controller = keepOthers && enrichRequest && !enrichRequest.signal.aborted ? enrichRequest : new AbortController();
    enrichRequest = controller;
    if (!keepOthers) {
      const next = new Map<string, MaterialRowInfo>();
      for (const item of items) next.set(item.id, { ...info.value.get(item.id), material: item, loading: true });
      info.value = next;
    }
    let jobs: Map<string, JobRead> | undefined;
    try {
      jobs = await latestJobs(new Set(items.map((item) => item.current_original_id)), controller.signal);
    } catch {
      jobs = undefined;
    }
    if (controller.signal.aborted) return;
    await Promise.all(items.map((item) => enrichOne(item, jobs, controller.signal)));
    if (!controller.signal.aborted) schedulePoll();
  }

  function activeItems() {
    return (page.value?.items ?? []).filter((item) => {
      const row = info.value.get(item.id);
      return row && materialParseState(row.job, row.parse).active;
    });
  }
  function schedulePoll() {
    if (pollTimer) clearTimeout(pollTimer);
    if (disposed || !activeItems().length) return;
    pollTimer = setTimeout(() => {
      const items = activeItems();
      if (items.length) void enrich(items, true);
    }, 2500);
  }

  /** The detail panel owns the authoritative task for the selected original; mirror it into the row. */
  function setJob(material: Material, job: JobRead) {
    if (jobOriginalId(job) !== material.current_original_id) return;
    const row = info.value.get(material.id);
    if (!row) return;
    setInfo(material.id, { material: row.material, job });
    if (job.status === "succeeded") void enrich([row.material], true);
  }
  function replace(material: Material) {
    if (!page.value) return;
    page.value = { ...page.value, items: page.value.items.map((item) => (item.id === material.id ? material : item)) };
    const row = info.value.get(material.id);
    if (row) setInfo(material.id, { material });
  }
  function refresh() {
    void load();
    void loadCounts();
  }
  function stop() {
    listRequest?.abort();
    countRequest?.abort();
    enrichRequest?.abort();
    if (pollTimer) clearTimeout(pollTimer);
    busy.value = false;
  }

  watch([tab, category, includeRemoved], ([nextTab], [previousTab]) => {
    if (nextTab !== previousTab && category.value !== "all") {
      category.value = "all";
      return;
    }
    void load(0);
  });
  watch(includeRemoved, () => void loadCounts());
  onScopeDispose(() => {
    disposed = true;
    stop();
  });

  return {
    tab,
    category,
    includeRemoved,
    query,
    pinned,
    page,
    busy,
    error,
    offset,
    counts,
    linkedTotal,
    countsError,
    info,
    visible,
    filtered,
    load,
    loadCounts,
    refresh,
    setJob,
    replace,
    stop,
  };
}
