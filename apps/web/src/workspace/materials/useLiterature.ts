import { computed, onScopeDispose, ref, shallowRef } from "vue";
import type { BackendServices } from "../../services/index.ts";
import { asApiError } from "../../services/errors.ts";

type Service = BackendServices["literature"];
export type LiteratureSearch = Awaited<ReturnType<Service["getSearch"]>>;
export type LiteratureEntry = Awaited<ReturnType<Service["getEntry"]>>;
export type LiteratureResult = NonNullable<LiteratureSearch["snapshot"]>["items"][number];
export type LiteratureVersion = Awaited<ReturnType<Service["versions"]>>["items"][number];
export type LiteratureSourceName = LiteratureSearch["source"];
export type LiteratureSelection = { kind: "result"; index: number } | { kind: "entry"; id: string };

export const sourceOptions: { value: LiteratureSourceName; label: string }[] = [
  { value: "crossref", label: "Crossref" },
  { value: "openalex", label: "OpenAlex" },
];
export const sourceLabel = (source: LiteratureSourceName) => sourceOptions.find((item) => item.value === source)?.label ?? source;
const POLL_MS = 1200;
const isActive = (search?: LiteratureSearch) => search?.status === "queued" || search?.status === "running";
const YEAR = /^\d{4}$/;

/**
 * Literature index state. Each search run is fixed on the server; this keeps only the
 * latest run, polls it while active, and drops responses for a replaced run or project.
 */
export function useLiterature(services: BackendServices, projectId: () => string) {
  const query = ref("");
  const source = ref<LiteratureSourceName>("crossref");
  const yearFrom = ref("");
  const yearTo = ref("");
  const formError = ref("");
  const search = shallowRef<LiteratureSearch>();
  const searchError = ref("");
  const submitting = ref(false);
  const entries = shallowRef<LiteratureEntry[]>([]);
  const entriesTotal = ref<number>();
  const entriesError = ref("");
  const entriesLoading = ref(false);
  const includeRemoved = ref(false);
  const selection = shallowRef<LiteratureSelection>();
  /** The entry last changed here stays open after removal, so it can be restored in place. */
  const focused = shallowRef<LiteratureEntry>();
  const pending = ref<string>();
  const actionError = ref("");
  let generation = 0;
  let scope = 0;
  let pollTimer: ReturnType<typeof setTimeout> | undefined;
  let pollRequest: AbortController | undefined;
  let entriesRequest: AbortController | undefined;

  const results = computed(() => search.value?.snapshot?.items ?? []);
  const running = computed(() => isActive(search.value));
  const selectedResult = computed(() => (selection.value?.kind === "result" ? results.value[selection.value.index] : undefined));
  const selectedEntry = computed(() => {
    const current = selection.value;
    if (current?.kind !== "entry") return undefined;
    return entries.value.find((item) => item.id === current.id) ?? (focused.value?.id === current.id ? focused.value : undefined);
  });

  function stopPolling() {
    clearTimeout(pollTimer);
    pollTimer = undefined;
    pollRequest?.abort();
  }
  function schedule(token: number) {
    stopPolling();
    if (!isActive(search.value)) return;
    pollTimer = setTimeout(() => void poll(token), POLL_MS);
  }
  async function poll(token: number) {
    const current = search.value;
    if (!current || token !== generation) return;
    const controller = new AbortController();
    pollRequest = controller;
    try {
      const next = await services.literature.getSearch(projectId(), current.id, controller.signal);
      if (controller.signal.aborted || token !== generation || search.value?.id !== next.id) return;
      search.value = next;
      searchError.value = "";
      if (next.status === "succeeded") void loadEntries();
    } catch (cause) {
      if (controller.signal.aborted || token !== generation) return;
      searchError.value = asApiError(cause).message;
    }
    schedule(token);
  }

  function setSearch(next: LiteratureSearch, token: number) {
    search.value = next;
    if (selection.value?.kind === "result") selection.value = undefined;
    schedule(token);
  }

  function validYears(): { from: number | null; to: number | null } | undefined {
    const from = yearFrom.value.trim();
    const to = yearTo.value.trim();
    if ((from && !YEAR.test(from)) || (to && !YEAR.test(to))) return void (formError.value = "年份请填写四位数字，例如 2018。");
    const parsed = { from: from ? Number(from) : null, to: to ? Number(to) : null };
    if ([parsed.from, parsed.to].some((value) => value !== null && (value < 1900 || value > 2100))) return void (formError.value = "年份需在 1900—2100 之间。");
    if (parsed.from !== null && parsed.to !== null && parsed.from > parsed.to) return void (formError.value = "起始年份不能晚于结束年份。");
    return parsed;
  }

  async function submit() {
    formError.value = "";
    searchError.value = "";
    const text = query.value.split(/\s+/).filter(Boolean).join(" ");
    if (!text) return void (formError.value = "请输入检索式，例如研究主题或关键词。");
    const years = validYears();
    if (!years || submitting.value || running.value) return;
    const token = ++generation;
    submitting.value = true;
    try {
      const receipt = await services.literature.search(projectId(), {
        command_id: crypto.randomUUID(),
        query: text,
        source: source.value,
        year_from: years.from,
        year_to: years.to,
        rows: 10,
      });
      if (token === generation) setSearch(receipt.search, token);
    } catch (cause) {
      if (token === generation) searchError.value = asApiError(cause).message;
    } finally {
      if (token === generation) submitting.value = false;
    }
  }

  async function cancel() {
    const current = search.value;
    if (!current || !isActive(current)) return;
    const token = generation;
    pending.value = "cancel";
    try {
      const next = await services.literature.cancelSearch(projectId(), current.id);
      if (token === generation && search.value?.id === next.id) setSearch(next, token);
    } catch (cause) {
      if (token === generation) searchError.value = asApiError(cause).message;
    } finally {
      pending.value = undefined;
    }
  }

  async function retry() {
    const current = search.value;
    if (!current || (current.status !== "failed" && current.status !== "cancelled")) return;
    const token = ++generation;
    searchError.value = "";
    pending.value = "retry";
    try {
      const receipt = await services.literature.retrySearch(projectId(), current.id, { command_id: crypto.randomUUID() });
      if (token === generation) setSearch(receipt.search, token);
    } catch (cause) {
      if (token === generation) searchError.value = asApiError(cause).message;
    } finally {
      pending.value = undefined;
    }
  }

  async function loadEntries() {
    entriesRequest?.abort();
    const controller = new AbortController();
    entriesRequest = controller;
    const token = scope;
    entriesLoading.value = true;
    try {
      const page = await services.literature.entries(projectId(), { includeRemoved: includeRemoved.value, limit: 100 }, controller.signal);
      if (controller.signal.aborted || token !== scope) return;
      entries.value = page.items;
      entriesTotal.value = includeRemoved.value ? page.items.filter((item) => !item.removed).length : page.total;
      entriesError.value = "";
    } catch (cause) {
      if (!controller.signal.aborted && token === scope) entriesError.value = asApiError(cause).message;
    } finally {
      if (entriesRequest === controller) entriesLoading.value = false;
    }
  }

  async function load() {
    stop();
    const token = ++generation;
    search.value = undefined;
    entries.value = [];
    focused.value = undefined;
    entriesTotal.value = undefined;
    selection.value = undefined;
    searchError.value = entriesError.value = actionError.value = formError.value = "";
    void loadEntries();
    try {
      const latest = (await services.literature.searches(projectId(), { limit: 1 })).items[0];
      if (token !== generation || !latest) return;
      setSearch(latest, token);
      query.value = latest.query;
      source.value = latest.source;
      yearFrom.value = latest.year_from === null ? "" : String(latest.year_from);
      yearTo.value = latest.year_to === null ? "" : String(latest.year_to);
    } catch (cause) {
      if (token === generation) searchError.value = asApiError(cause).message;
    }
  }

  function replaceEntry(next: LiteratureEntry) {
    const list = entries.value.filter((item) => item.id !== next.id);
    if (!next.removed || includeRemoved.value) list.unshift(next);
    entries.value = list.sort((a, b) => b.created_at.localeCompare(a.created_at) || b.id.localeCompare(a.id));
  }

  /** Commands run against the entry as last read; a version conflict reloads the list. */
  async function act(key: string, run: () => Promise<LiteratureEntry>, after?: (entry: LiteratureEntry) => void) {
    if (pending.value) return;
    const token = scope;
    const searchToken = generation;
    pending.value = key;
    actionError.value = "";
    try {
      const entry = await run();
      if (token !== scope) return;
      focused.value = entry;
      replaceEntry(entry);
      after?.(entry);
      void loadEntries();
      if (search.value?.status === "succeeded") void refreshSearch(searchToken);
    } catch (cause) {
      if (token !== scope) return;
      const failure = asApiError(cause);
      actionError.value = failure.message;
      if (failure.code.endsWith("_VERSION_CONFLICT") || failure.code.endsWith("_STATE_CONFLICT") || failure.code.endsWith("_DUPLICATE")) void loadEntries();
    } finally {
      if (token === scope) pending.value = undefined;
    }
  }

  async function refreshSearch(token: number) {
    const current = search.value;
    if (!current) return;
    try {
      const next = await services.literature.getSearch(projectId(), current.id);
      if (token === generation && search.value?.id === next.id) search.value = next;
    } catch {
      // The saved entry is already shown; the result badges refresh on the next read.
    }
  }

  function save(result: LiteratureResult) {
    const current = search.value;
    if (!current || current.status !== "succeeded") return;
    void act(
      `save:${result.index}`,
      () => services.literature.save(projectId(), { command_id: crypto.randomUUID(), search_id: current.id, result_index: result.index }),
      (entry) => (selection.value = { kind: "entry", id: entry.id }),
    );
  }
  const command = (entry: LiteratureEntry) => ({ command_id: crypto.randomUUID(), expected_version: entry.version });
  const remove = (entry: LiteratureEntry) => void act(`remove:${entry.id}`, () => services.literature.remove(projectId(), entry.id, command(entry)));
  const restore = (entry: LiteratureEntry) => void act(`restore:${entry.id}`, () => services.literature.restore(projectId(), entry.id, command(entry)));
  const verify = (entry: LiteratureEntry) => void act(`verify:${entry.id}`, () => services.literature.verify(projectId(), entry.id, command(entry)));

  function stop() {
    generation++;
    scope++;
    stopPolling();
    entriesRequest?.abort();
    submitting.value = false;
    pending.value = undefined;
  }
  onScopeDispose(stop);

  return {
    query,
    source,
    yearFrom,
    yearTo,
    formError,
    search,
    searchError,
    submitting,
    running,
    results,
    entries,
    entriesTotal,
    entriesError,
    entriesLoading,
    includeRemoved,
    selection,
    selectedResult,
    selectedEntry,
    pending,
    actionError,
    load,
    loadEntries,
    submit,
    cancel,
    retry,
    save,
    remove,
    restore,
    verify,
    stop,
  };
}
export type LiteratureState = ReturnType<typeof useLiterature>;
