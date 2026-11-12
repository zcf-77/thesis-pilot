import type { AgentKind } from "../../domain/types.ts";
import type { LibraryState } from "../state/libraryState.ts";
import type { WritingConstraints, WritingRequest, WritingRuleSnapshot } from "../state/writingState.ts";
import { evaluateLibraryRequirement, inferRuleType } from "./libraryService.ts";

/** 固定项目绑定版本，判定只使用同一要求集，不能混入尚未绑定的新规则。 */
export function captureWritingConstraints(
  library: LibraryState,
  input: { requirementVersion: number; templateVersion: number; documentVersion: number; html: string },
): WritingConstraints {
  const set = library.requirementSets.find((entry) => entry.version === input.requirementVersion);
  const requirements: WritingConstraints["requirements"] = {
    version: input.requirementVersion,
    state: !input.requirementVersion ? "unbound" : set ? "bound" : "missing",
    note: !input.requirementVersion
      ? "项目尚未绑定要求，不能判断是否符合要求。"
      : !set
        ? "绑定要求版本不存在，未改用最新要求。"
        : "按绑定要求及本次正文运行程序检查；语义预览仅供审阅。",
    rules: [],
  };
  if (requirements.state === "bound" && set) {
    const scope = { ...library, requirements: set.items };
    requirements.rules = set.items.map((item): WritingRuleSnapshot => {
      const material = library.materials.find((entry) => entry.id === item.sourceMaterialId);
      const evaluated = evaluateLibraryRequirement(item, input.html, scope, input.documentVersion);
      const missingSource = item.enabled && (material?.removed || !material?.versions.some((entry) => entry.version === item.sourceVersion));
      return {
        id: item.id,
        version: item.version,
        text: item.text,
        param: item.param ?? "",
        kind: item.kind,
        ruleType: inferRuleType(item),
        scope: item.scope,
        strictness: item.strictness,
        enabled: item.enabled,
        verdict: missingSource ? "nosource" : evaluated.verdict,
        verdictNote: missingSource ? "来源资料或原版本不可用，不能据此执行。" : (evaluated.verdictNote ?? "未提供判定依据。"),
        source: {
          materialId: item.sourceMaterialId,
          version: item.sourceVersion,
          title: material?.name ?? item.source ?? "来源缺失",
          position: item.position,
          original: item.original,
        },
      };
    });
  }
  const binding = library.templateBinding;
  const material = library.materials.find((entry) => entry.id === binding?.materialId && !entry.removed);
  const version = binding?.version === input.templateVersion ? material?.versions.find((entry) => entry.version === input.templateVersion) : undefined;
  const template: WritingConstraints["template"] = {
    version: input.templateVersion,
    state: !input.templateVersion ? "unbound" : version ? "bound" : "missing",
    note: !input.templateVersion
      ? "项目尚未绑定模板，未推断格式要求。"
      : !version
        ? "绑定模板原版本不可用或绑定不一致，未使用其他版本替代。"
        : "模板识别结果不是排版合格判定；仅标题层级、对齐和粗细可生成受支持的格式候选。",
    materialId: binding?.materialId ?? "",
    title: material?.name ?? "",
    original: version?.extracted ?? "",
    items:
      version?.templateItems?.map((item) => ({
        name: item.name,
        value: item.value,
        support: item.support,
        state: item.state ?? (/未知|未识别/.test(item.value + item.support) ? "unknown" : "identified"),
        source: item.source ?? `${material?.name ?? "模板"} v${input.templateVersion}`,
      })) ?? [],
  };
  return JSON.parse(JSON.stringify({ documentVersion: input.documentVersion, requirements, template })) as WritingConstraints;
}

const verdictNames = { pass: "程序通过", fail: "未通过", advice: "语义建议", unknown: "未判定", conflict: "冲突", nosource: "来源缺失" };
const templateNames = { identified: "已识别", unknown: "未知", conflict: "冲突" };
export function writingConstraintBasis(request: WritingRequest): string[] {
  const constraints = request.constraints;
  if (!constraints) return ["此历史请求未保存要求与模板内容，不能根据版本号推断已满足规范。"];
  return [
    `要求 v${constraints.requirements.version}：${constraints.requirements.note}`,
    ...constraints.requirements.rules.map(
      (rule) =>
        `${rule.id} · ${rule.enabled ? verdictNames[rule.verdict] : "已停用，不执行"} · ${rule.text}${rule.param ? `（${rule.param}）` : ""} · 范围：${rule.scope} · ${rule.strictness}；${rule.verdictNote} 来源：${rule.source.title} v${rule.source.version} ${rule.source.position}；原文：${rule.source.original}`,
    ),
    `模板 v${constraints.template.version}：${constraints.template.note}`,
    ...constraints.template.items.map((item) => `${item.name}：${item.value} · ${templateNames[item.state]} · ${item.support}；来源：${item.source}`),
  ];
}

/** 本地助手按职责读取同一规则快照，给出有限范围建议，不伪造全文合规结论。 */
export function writingConstraintAdvice(request: WritingRequest, agent: AgentKind): string {
  const constraints = request.constraints;
  if (!constraints) return "缺少规则内容快照，不能宣称已按要求完成核对。";
  const rules = constraints.requirements.rules.filter((rule) => rule.enabled);
  const relevant = rules.filter((rule) => {
    if (agent === "lit") return ["references", "recentReferences", "semantic"].includes(rule.ruleType);
    if (agent === "format") return ["headings", "format"].includes(rule.ruleType);
    if (agent === "content") return ["characters", "chapters", "headings", "semantic"].includes(rule.ruleType);
    return true;
  });
  const lines = relevant.map((rule) => {
    const target = `${rule.text}${rule.param ? `（${rule.param}）` : ""}，适用范围：${rule.scope}`;
    const action =
      rule.verdict === "conflict"
        ? "先澄清冲突，不能擅自选择一个标准。"
        : rule.verdict === "nosource"
          ? "先补全来源，不按无来源规则改稿。"
          : rule.verdict === "unknown"
            ? "保留未判定，需要补充依据或人工核对。"
            : rule.verdict === "fail"
              ? rule.ruleType === "characters"
                ? "请按范围补充或精简有依据的内容；本次润色不视为完成字数要求。"
                : "优先核对该项缺口，当前选区调整不能代表整篇达标。"
              : rule.verdict === "advice"
                ? "仅作为语义预览建议，需人工审阅。"
                : "只确认这一程序规则，未覆盖全文学术与格式要求。";
    return `${rule.id} ${verdictNames[rule.verdict]}：${target}。${action}`;
  });
  if (constraints.requirements.state !== "bound") lines.unshift(constraints.requirements.note);
  else if (!relevant.length) lines.push("本次绑定要求中没有已启用且适用于该助手的规则；不推断规范已满足。");
  if (agent === "format" || agent === "general") {
    lines.push(constraints.template.note);
    lines.push(
      ...constraints.template.items.map(
        (item) =>
          `${item.name} ${item.value}（${templateNames[item.state]}）：${item.state === "identified" ? `仅按已注明支持范围处理：${item.support}` : "保留待核对，不自动套用"}。`,
      ),
    );
  }
  return lines.join("\n");
}
