import { onScopeDispose, reactive } from "vue";
import type { BackendServices, ProjectRead } from "../../services/index.ts";
import { asApiError } from "../../services/errors.ts";
import { stageName, type FlowBinding } from "./flowCatalog.ts";

type SourceBinding = Awaited<ReturnType<BackendServices["materials"]["sourceBinding"]>>;
export type Fact<T> = { state: "loading" } | { state: "ready"; value: T } | { state: "missing" } | { state: "failed" };
export interface ProjectFacts {
  sources: Fact<SourceBinding>;
  document: Fact<number>;
}
export type Catalog = { state: "loading" } | { state: "ready"; versions: ReadonlyMap<string, FlowBinding> } | { state: "failed" };

const dateFormat = new Intl.DateTimeFormat("zh-CN", { dateStyle: "medium" });

export function deadlineLabel(deadline: string | null) {
  if (!deadline) return "未设置";
  const [year, month, day] = deadline.split("-").map(Number);
  return year && month && day ? dateFormat.format(new Date(year, month - 1, day)) : deadline;
}

export function stageLabel(project: ProjectRead, catalog: Catalog) {
  if (!project.flow_version_id) return "未绑定流程";
  if (catalog.state !== "ready") return catalog.state === "loading" ? "读取阶段…" : "阶段暂时无法读取";
  return stageName(catalog.versions.get(project.flow_version_id), project.stage_id) ?? "阶段不在绑定版本中";
}

export function flowLabel(project: ProjectRead, catalog: Catalog) {
  if (!project.flow_version_id) return "流程未绑定";
  if (catalog.state !== "ready") return catalog.state === "loading" ? "读取流程…" : "流程暂时无法读取";
  const binding = catalog.versions.get(project.flow_version_id);
  return binding ? `${binding.flow.name} v${binding.version.version}` : "流程版本不可用";
}

export function sourcesLabel(fact: Fact<SourceBinding>) {
  if (fact.state === "loading") return "读取模板与要求…";
  if (fact.state !== "ready") return "模板与要求暂时无法读取";
  const { template_parse_version_id: template, requirement_parse_version_ids: requirements, version } = fact.value;
  if (!template && !requirements.length) return "模板与要求未绑定";
  return `${template ? "模板已绑定" : "模板未绑定"} · ${requirements.length ? `要求 ${requirements.length} 份` : "要求未绑定"} · 绑定 v${version}`;
}

export function planningLabel(project: ProjectRead) {
  if (project.planning_mode === "none") return "暂不规划 · 按已知节点推进";
  return project.plan_note.trim() || "个人规划";
}

export function documentLabel(fact: Fact<number>) {
  if (fact.state === "loading") return "读取正文…";
  if (fact.state === "missing") return "尚未创建正式稿";
  if (fact.state === "failed") return "正文暂时无法读取";
  return `v${fact.value}`;
}

/** Per-project source binding and current manuscript version, loaded once per project and dropped with the page. */
export function useProjectFacts(services: Pick<BackendServices, "materials" | "documents">) {
  const facts = reactive(new Map<string, ProjectFacts>());
  const controller = new AbortController();

  async function read<T>(key: "sources" | "document", id: string, load: () => Promise<T>, missing: string) {
    try {
      const value = await load();
      if (!controller.signal.aborted) facts.get(id)![key] = { state: "ready", value } as never;
    } catch (problem) {
      if (controller.signal.aborted) return;
      facts.get(id)![key] = asApiError(problem).code === missing ? { state: "missing" } : { state: "failed" };
    }
  }

  function load(id: string, force = false) {
    const known = facts.get(id);
    if (known && !force && known.sources.state !== "failed" && known.document.state !== "failed") return;
    facts.set(id, { sources: { state: "loading" }, document: { state: "loading" } });
    void read("sources", id, () => services.materials.sourceBinding(id, controller.signal), "PROJECT_NOT_FOUND");
    void read("document", id, async () => (await services.documents.current(id, controller.signal)).version, "DOCUMENT_NOT_FOUND");
  }

  onScopeDispose(() => controller.abort());
  return { facts, load };
}
