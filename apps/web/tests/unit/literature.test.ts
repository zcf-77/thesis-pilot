import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { effectScope, nextTick } from "vue";
import { createServices, type BackendServices } from "../../src/services/index.ts";
import type { LiteratureEntryRead, LiteratureSearchRead } from "../../src/services/contracts/api.generated.ts";
import { canRerunServiceJob, serviceJobFailure, serviceJobTitle } from "../../src/lab/state/serviceJobs.ts";
import { useLiterature } from "../../src/workspace/materials/useLiterature.ts";
import { literatureMeta, verificationView } from "../../src/workspace/materials/literaturePresentation.ts";

afterEach(() => vi.useRealTimers());
const now = () => new Date().toISOString();

function record(overrides: Record<string, unknown> = {}) {
  return {
    source: "crossref" as const,
    source_id: "10.5555/cf.1",
    doi: "10.5555/cf.1",
    title: "合成协同过滤研究",
    authors: ["甲", "乙", "丙", "丁"],
    year: 2021,
    venue: "合成期刊",
    publisher: null,
    work_type: "journal-article",
    abstract: "合成摘要。",
    source_url: "https://doi.org/10.5555/cf.1",
    coverage: "abstract" as const,
    ...overrides,
  };
}

function searchRead(projectId: string, overrides: Partial<LiteratureSearchRead> = {}): LiteratureSearchRead {
  const id = crypto.randomUUID();
  return {
    id,
    project_id: projectId,
    job_id: crypto.randomUUID(),
    status: "succeeded",
    attempt: 1,
    error_code: null,
    query: "协同过滤",
    source: "crossref",
    year_from: null,
    year_to: null,
    rows: 10,
    source_search_id: null,
    snapshot: {
      id: crypto.randomUUID(),
      source: "crossref",
      adapter_version: "thesispilot-literature-1",
      response_sha256: "a".repeat(64),
      total_results: 3,
      skipped_count: 0,
      retrieved_at: now(),
      items: [{ ...record(), index: 0, saved_entry_id: null }],
    },
    created_at: now(),
    updated_at: now(),
    ...overrides,
  };
}

function entryRead(projectId: string, overrides: Partial<LiteratureEntryRead> = {}): LiteratureEntryRead {
  return {
    id: crypto.randomUUID(),
    project_id: projectId,
    version: 1,
    removed: false,
    search_id: crypto.randomUUID(),
    snapshot_id: crypto.randomUUID(),
    result_index: 0,
    record: record(),
    verification: "verified",
    verification_detail: { checked: true, reason: "match", error_code: null, registry_title: "合成协同过滤研究", registry_year: 2021 },
    verified_at: now(),
    retrieved_at: now(),
    created_at: now(),
    updated_at: now(),
    ...overrides,
  };
}

const json = (value: unknown) => new Response(JSON.stringify(value), { headers: { "content-type": "application/json" } });

describe("SG-11 文献检索同契约服务", () => {
  it("Mock 队列像无网络的服务器一样明确失败，从不编造题录", async () => {
    vi.useFakeTimers();
    const api = createServices({ mode: "mock", instanceId: `lit-${crypto.randomUUID()}` });
    const project = await api.projects.create({ name: "合成文献项目" });
    const command = crypto.randomUUID();
    const receipt = await api.literature.search(project.id, { command_id: command, query: "  协同过滤   推荐系统 " });
    expect(receipt.search).toMatchObject({ status: "queued", query: "协同过滤 推荐系统", source: "crossref", rows: 10, snapshot: null });
    expect(receipt.job.kind).toBe("literature_search");
    expect(serviceJobTitle(receipt.job)).toBe("文献检索");
    expect(canRerunServiceJob({ ...receipt.job, status: "failed" })).toBe(false);
    expect((await api.literature.search(project.id, { command_id: command, query: "协同过滤 推荐系统" })).search.id).toBe(receipt.search.id);
    await expect(api.literature.search(project.id, { command_id: command, query: "别的" })).rejects.toMatchObject({ code: "LITERATURE_COMMAND_CONFLICT" });
    await expect(api.literature.search(project.id, { command_id: crypto.randomUUID(), query: "别的" })).rejects.toMatchObject({
      code: "LITERATURE_SEARCH_BUSY",
    });
    await expect(api.literature.save(project.id, { command_id: crypto.randomUUID(), search_id: receipt.search.id, result_index: 0 })).rejects.toMatchObject({
      code: "LITERATURE_SEARCH_NOT_READY",
    });
    vi.setSystemTime(Date.now() + 5_000);
    const failed = await api.literature.getSearch(project.id, receipt.search.id);
    expect(failed).toMatchObject({ status: "failed", error_code: "LITERATURE_SOURCE_UNAVAILABLE", snapshot: null });
    expect(serviceJobFailure({ ...receipt.job, status: "failed", error_code: "LITERATURE_SOURCE_UNAVAILABLE" })).toContain("文献来源暂时无法访问");
    const retried = await api.literature.retrySearch(project.id, receipt.search.id, { command_id: crypto.randomUUID() });
    expect(retried.search).toMatchObject({ source_search_id: receipt.search.id, query: "协同过滤 推荐系统" });
    expect(retried.job.source_job_id).toBe(receipt.job.id);
    expect((await api.literature.entries(project.id)).total).toBe(0);
    const other = await api.projects.create({ name: "隔离项目" });
    await expect(api.literature.getSearch(other.id, receipt.search.id)).rejects.toMatchObject({ code: "LITERATURE_SEARCH_NOT_FOUND" });
  });

  it("HTTP 拒绝越项目、结果与状态不一致或取得范围与摘要不符的响应", async () => {
    const projectId = crypto.randomUUID();
    let body: unknown = searchRead(projectId);
    const fetcher = vi.fn<typeof fetch>(async () => json(body));
    const http = createServices({ mode: "http", instanceId: "lit-http", fetch: fetcher });
    const ok = body as LiteratureSearchRead;
    expect((await http.literature.getSearch(projectId, ok.id)).snapshot?.items).toHaveLength(1);
    await expect(http.literature.getSearch(crypto.randomUUID(), ok.id)).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
    body = { ...ok, status: "running" };
    await expect(http.literature.getSearch(projectId, ok.id)).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
    body = { ...ok, snapshot: { ...ok.snapshot!, items: [{ ...ok.snapshot!.items[0]!, abstract: null }] } };
    await expect(http.literature.getSearch(projectId, ok.id)).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
    body = entryRead(projectId, { verification: "verified", verification_detail: { checked: false, reason: "no_doi" } });
    await expect(http.literature.getEntry(projectId, (body as LiteratureEntryRead).id)).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
    await expect(http.literature.search(projectId, { command_id: crypto.randomUUID(), query: "x", rows: 30 })).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
    });
  });

  it("展示只用来源返回的字段，核验状态有明确后续说明", () => {
    expect(literatureMeta(record())).toBe("甲、乙、丙 等 · 2021 · 合成期刊");
    expect(literatureMeta(record({ authors: [], year: null, venue: null }))).toBe("来源未提供作者、年份与刊名");
    const projectId = crypto.randomUUID();
    expect(verificationView(entryRead(projectId)).label).toBe("DOI 已回查");
    expect(
      verificationView(entryRead(projectId, { verification: "conflict", verification_detail: { checked: true, reason: "year_mismatch", registry_year: 2019 } }))
        .note,
    ).toContain("2019");
    expect(verificationView(entryRead(projectId, { verification: "unverified", verification_detail: { checked: false, reason: "no_doi" } })).note).toContain(
      "没有提供 DOI",
    );
  });
});

describe("文献索引状态", () => {
  function fakeServices(literature: Partial<BackendServices["literature"]>): BackendServices {
    const empty = { items: [], total: 0, limit: 1, offset: 0 };
    return {
      literature: {
        searches: async () => empty,
        entries: async () => ({ ...empty, limit: 100 }),
        ...literature,
      },
    } as unknown as BackendServices;
  }

  it("被新检索替换或已切换项目后，迟到的旧响应不会覆盖当前结果", async () => {
    vi.useFakeTimers();
    const projectId = crypto.randomUUID();
    const first = searchRead(projectId, { status: "running", snapshot: null, query: "旧检索" });
    const second = searchRead(projectId, { query: "新检索" });
    let releaseOld: (value: LiteratureSearchRead) => void = () => undefined;
    let calls = 0;
    const services = fakeServices({
      search: async (_project, input) => {
        calls++;
        return { search: calls === 1 ? first : { ...second, query: input.query }, job: {} as never };
      },
      getSearch: () => new Promise<LiteratureSearchRead>((resolve) => (releaseOld = resolve)),
      cancelSearch: async () => ({ ...first, status: "cancelled", snapshot: null }),
    });
    const scope = effectScope();
    const state = scope.run(() => useLiterature(services, () => projectId))!;
    await state.load();
    state.query.value = "旧检索";
    await state.submit();
    expect(state.running.value).toBe(true);
    vi.advanceTimersByTime(1500);
    await state.cancel();
    expect(state.search.value?.status).toBe("cancelled");
    state.query.value = "新检索";
    await state.submit();
    expect(state.search.value?.query).toBe("新检索");
    releaseOld({ ...first, status: "succeeded", snapshot: searchRead(projectId).snapshot });
    await nextTick();
    await Promise.resolve();
    expect(state.search.value?.id).toBe(second.id);
    expect(state.results.value[0]?.title).toBe("合成协同过滤研究");
    scope.stop();
  });

  it("移出后条目仍停在详情中可原地恢复，校验年份输入", async () => {
    const projectId = crypto.randomUUID();
    const entry = entryRead(projectId);
    const services = fakeServices({
      entries: async (_p, query) => ({ items: query?.includeRemoved ? [{ ...entry, removed: true, version: 2 }] : [], total: 0, limit: 100, offset: 0 }),
      remove: async (_p, _id, input) => {
        expect(input.expected_version).toBe(1);
        return { ...entry, removed: true, version: 2 };
      },
      restore: async () => ({ ...entry, removed: false, version: 3 }),
    });
    const scope = effectScope();
    const state = scope.run(() => useLiterature(services, () => projectId))!;
    await state.load();
    state.entries.value = [entry];
    state.selection.value = { kind: "entry", id: entry.id };
    state.remove(entry);
    await vi.waitFor(() => expect(state.selectedEntry.value?.removed).toBe(true));
    expect(state.selectedEntry.value?.version).toBe(2);
    state.restore(state.selectedEntry.value!);
    await vi.waitFor(() => expect(state.selectedEntry.value?.removed).toBe(false));

    state.query.value = "协同过滤";
    state.yearFrom.value = "20";
    await state.submit();
    expect(state.formError.value).toContain("四位数字");
    state.yearFrom.value = "2024";
    state.yearTo.value = "2020";
    await state.submit();
    expect(state.formError.value).toContain("起始年份");
    scope.stop();
  });
});
