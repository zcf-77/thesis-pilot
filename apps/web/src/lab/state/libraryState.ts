import type { LiteratureView, MaterialView, RequirementView } from "../../domain/types.ts";
import { literature, materials, requirements } from "../fixtures.ts";
import { usePreviewModule, usePreviewWorkspaceStore } from "./previewWorkspace.ts";
import { evaluateLibraryRequirement, parseLibraryText, type LibraryRuleType } from "../services/libraryService.ts";

export interface LibraryVersion {
  version: number;
  at: string;
  reason: string;
  originalName: string;
  mime: string;
  dataUrl: string;
  extracted: string;
  status: MaterialView["status"];
  diagnosis: string;
  attempts?: { at: string; result: string }[];
  templateItems?: TemplateItem[];
  purpose?: string;
  fragments?: { id: string; line: number; text: string }[];
}
export interface TemplateItem {
  name: string;
  value: string;
  support: string;
  state?: "identified" | "unknown" | "conflict";
  source?: string;
}
export interface LibraryMaterial extends MaterialView {
  source: string;
  linked: boolean;
  removed: boolean;
  cancelled: boolean;
  versions: LibraryVersion[];
  purpose: string;
  templateItems: TemplateItem[];
  categoryId?: string;
  businessKind?: "template" | "requirements" | "literature" | "other";
}
export interface LibraryRequirement extends RequirementView {
  original: string;
  sourceMaterialId: string;
  sourceVersion: number;
  position: string;
  scope: string;
  strictness: string;
  enabled: boolean;
  ruleType?: LibraryRuleType;
  history: {
    version: number;
    at: string;
    text: string;
    param: string;
    enabled: boolean;
    reason: string;
    scope?: string;
    strictness?: string;
    kind?: string;
    sourceMaterialId?: string;
    sourceVersion?: number;
    position?: string;
  }[];
}
export interface LibraryLiterature extends LiteratureView {
  abstractText: string;
  fullText: string;
  sourceText: string;
  version?: number;
  verificationNote?: string;
  history?: { version: number; at: string; sourceText: string; abstractText: string; fullText: string; verify: LiteratureView["verify"]; note: string }[];
}
export interface LibrarySourceSnapshot {
  id: string;
  version: number;
  title: string;
  text: string;
  verify: "verified";
  coverage: { biblio: boolean; abstract: boolean; fulltext: boolean };
  position?: string;
}
export interface LibrarySemanticCheck {
  status: "running" | "done" | "failed" | "cancelled";
  inputVersion: number;
  requirementVersion: number;
  explanation: string;
  evidence: string[];
  token: string;
}
export interface LibraryState {
  materials: LibraryMaterial[];
  requirements: LibraryRequirement[];
  literature: LibraryLiterature[];
  requirementsVersion: number;
  contextLiteratureIds: string[];
  requirementSets: { version: number; items: LibraryRequirement[] }[];
  templateBinding: { materialId: string; version: number } | null;
  citationRequest: { ids: string[]; baseVersion: number; text: string; sources?: LibrarySourceSnapshot[] } | null;
  contextSources?: LibrarySourceSnapshot[];
  formatRequest?: {
    materialId: string;
    templateVersion: number;
    baseVersion: number;
    operation: "normalize-headings";
    label: string;
    sourceText: string;
    align?: "left" | "center";
    fontWeight?: "600" | "700";
  } | null;
  semanticChecks?: Record<string, LibrarySemanticCheck>;
}

const excerpts: Record<string, string> = {
  m1: "第三章 · 论文撰写要求\n3.1 正文字数\n本科毕业论文正文字数应不少于 12000 字。字数统计不包含封面、目录、图表与参考文献。\n3.4 摘要 300–500 字。\n4.2 参考文献不少于 15 篇，近五年文献占比不低于三分之一。",
  m2: "标题样式 · 模板说明\n一级标题：三号黑体，居中。\n摘要：摘要字数不超过 300 字。\n未识别：奇偶页页眉、目录域、封面文本框。",
  m5: "一、研究内容\n围绕校园二手交易场景，研究混合推荐算法的设计与实现。通过对比实验，分析不同召回策略的表现。",
};

export function createLibraryState(sample = true): LibraryState {
  const state: LibraryState = {
    materials: materials.map((item) => ({
      ...structuredClone(item),
      source: "自制设计样例（未提供原件文件）",
      linked: true,
      removed: false,
      cancelled: false,
      purpose: item.category === "模板" ? "理工类毕业论文的结构与格式示例" : "项目研究依据",
      businessKind: item.category === "模板" ? "template" : item.category === "规范" ? "requirements" : item.category === "文献附件" ? "literature" : "other",
      diagnosis: item.id === "m4" ? "历史图片资料样例，未提供原件和 OCR。导师反馈请在反馈空间粘贴文字。" : item.diagnosis,
      versions: [
        {
          version: item.version,
          at: item.at,
          reason: "自制样例",
          originalName: "",
          mime: "",
          dataUrl: "",
          extracted: excerpts[item.id] ?? "",
          status: item.status,
          diagnosis: item.diagnosis ?? "",
        },
      ],
      templateItems:
        item.category === "模板"
          ? [
              { name: "标题层级", value: "一级标题 / 二级标题 / 三级标题", support: "结构可编辑" },
              { name: "一级标题", value: "三号黑体，居中", support: "当前排版引擎不保证导出" },
              { name: "段落", value: "首行缩进两字符", support: "待接入格式应用" },
              { name: "页边距", value: "未知", support: "未识别" },
              { name: "页眉页脚", value: "未知", support: "未识别" },
              { name: "目录域", value: "未知", support: "不支持编辑" },
            ]
          : [],
    })),
    requirements: requirements.map((item) => ({
      ...structuredClone(item),
      original: item.text,
      sourceMaterialId: item.source ? (item.id === "R-021" ? "m2" : "m1") : "",
      sourceVersion: item.id === "R-021" ? 3 : 2,
      position: item.source ?? "来源未知",
      scope: item.category === "格式" ? "一级标题" : item.text.includes("摘要") ? "摘要" : "整篇论文",
      strictness: item.kind === "hard" ? "硬性" : "建议",
      enabled: item.verdict !== "nosource",
      history: [
        { version: item.version, at: "初始样例", text: item.text, param: item.param ?? "", enabled: item.verdict !== "nosource", reason: "原始提取样例" },
      ],
    })),
    literature: literature.map((item) => ({
      ...structuredClone(item),
      saved: false,
      sourceText: `自制样例库 / ${item.id}\n${item.meta}\n无真实 DOI、期刊或出版页码。`,
      version: 1,
      history: [],
      abstractText: item.coverage.abstract ? `自制摘要：${item.title}。本材料用于比较推荐方法的适用条件与数据范围，不代表真实研究结论。` : "",
      fullText: item.coverage.fulltext
        ? "自制全文节选：\n1. 研究问题：稀疏交互场景中的候选召回。\n2. 方法描述：比较协同过滤与内容特征的组合思路。\n3. 限制：未提供真实实验数据，不能作为真实论文证据。"
        : "",
    })),
    requirementsVersion: sample ? 2 : 0,
    requirementSets: [],
    templateBinding: sample ? { materialId: "m2", version: 3 } : null,
    contextLiteratureIds: [],
    citationRequest: null,
    contextSources: [],
    formatRequest: null,
    semanticChecks: {},
  };
  for (const material of state.materials) {
    currentLibraryVersion(material).templateItems = structuredClone(material.templateItems);
    currentLibraryVersion(material).purpose = material.purpose;
    currentLibraryVersion(material).diagnosis = material.diagnosis ?? "";
    currentLibraryVersion(material).fragments = parseLibraryText(currentLibraryVersion(material).extracted, material.businessKind === "template").fragments;
  }
  if (!sample) {
    state.materials = [];
    state.requirements = [];
  }
  state.requirementSets.push({ version: state.requirementsVersion, items: structuredClone(state.requirements) });
  return state;
}

export function useLibraryState() {
  const workspace = usePreviewWorkspaceStore();
  return usePreviewModule("library", () => createLibraryState(workspace.current.sample));
}

export function materialBusinessKind(material: LibraryMaterial) {
  return (
    material.businessKind ??
    (material.category === "模板" ? "template" : material.category === "规范" ? "requirements" : material.category === "文献附件" ? "literature" : "other")
  );
}

export function libraryLiteratureSnapshot(item: LibraryLiterature): LibrarySourceSnapshot | null {
  if (item.verify !== "verified" || !item.sourceText.trim()) return null;
  return {
    id: item.id,
    version: item.version ?? 1,
    title: item.title,
    text: [item.sourceText, item.abstractText, item.fullText].filter(Boolean).join("\n\n"),
    verify: "verified",
    coverage: { ...item.coverage },
  };
}

export function snapshotLibraryRequirements(state: LibraryState) {
  state.requirementSets.push({ version: state.requirementsVersion, items: JSON.parse(JSON.stringify(state.requirements)) as LibraryRequirement[] });
}

export function boundLibraryRequirements(state: LibraryState, version: number) {
  return state.requirementSets.find((item) => item.version === version)?.items ?? [];
}

export function validateLibraryState(value: unknown): boolean {
  const row = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
  const strings = (v: Record<string, unknown>, keys: string[]) => keys.every((key) => typeof v[key] === "string");
  const number = (v: unknown) => typeof v === "number" && Number.isSafeInteger(v) && v >= 0;
  const list = (v: unknown, check: (item: unknown) => boolean) => Array.isArray(v) && v.every(check);
  const templateItem = (v: unknown) =>
    row(v) &&
    strings(v, ["name", "value", "support"]) &&
    (v.state === undefined || (typeof v.state === "string" && ["identified", "unknown", "conflict"].includes(v.state))) &&
    (v.source === undefined || typeof v.source === "string");
  const coverage = (v: unknown) => row(v) && ["biblio", "abstract", "fulltext"].every((key) => typeof v[key] === "boolean");
  const source = (v: unknown) =>
    row(v) &&
    strings(v, ["id", "title", "text"]) &&
    number(v.version) &&
    Number(v.version) > 0 &&
    v.verify === "verified" &&
    coverage(v.coverage) &&
    (v.position === undefined || typeof v.position === "string");
  const version = (v: unknown) =>
    row(v) &&
    number(v.version) &&
    strings(v, ["at", "reason", "originalName", "mime", "dataUrl", "extracted", "diagnosis"]) &&
    ["waiting", "processing", "parsed", "partial", "failed"].includes(String(v.status)) &&
    (v.templateItems === undefined || list(v.templateItems, templateItem)) &&
    (v.fragments === undefined || list(v.fragments, (f) => row(f) && strings(f, ["id", "text"]) && number(f.line) && Number(f.line) > 0));
  const requirement = (v: unknown) =>
    row(v) &&
    strings(v, ["id", "text", "original", "sourceMaterialId", "position", "scope", "strictness", "category"]) &&
    number(v.version) &&
    number(v.sourceVersion) &&
    typeof v.enabled === "boolean" &&
    ["hard", "semantic"].includes(String(v.kind)) &&
    ["pass", "fail", "advice", "unknown", "conflict", "nosource"].includes(String(v.verdict)) &&
    (v.ruleType === undefined ||
      (typeof v.ruleType === "string" &&
        ["characters", "references", "recentReferences", "chapters", "headings", "format", "semantic"].includes(v.ruleType))) &&
    list(v.history, (h) => row(h) && number(h.version) && strings(h, ["at", "text", "param", "reason"]) && typeof h.enabled === "boolean");
  return (
    row(value) &&
    number(value.requirementsVersion) &&
    list(
      value.materials,
      (m) =>
        row(m) &&
        strings(m, ["id", "name", "ext", "category", "size", "at", "source", "purpose"]) &&
        number(m.version) &&
        typeof m.linked === "boolean" &&
        typeof m.removed === "boolean" &&
        typeof m.cancelled === "boolean" &&
        (m.businessKind === undefined ||
          (typeof m.businessKind === "string" && ["template", "requirements", "literature", "other"].includes(m.businessKind))) &&
        (m.categoryId === undefined || typeof m.categoryId === "string") &&
        ["waiting", "processing", "parsed", "partial", "failed"].includes(String(m.status)) &&
        list(m.templateItems, templateItem) &&
        Array.isArray(m.versions) &&
        m.versions.length > 0 &&
        m.versions.some((v) => row(v) && v.version === m.version) &&
        list(m.versions, version),
    ) &&
    list(value.requirements, requirement) &&
    list(value.requirementSets, (set) => row(set) && number(set.version) && list(set.items, requirement)) &&
    list(
      value.literature,
      (item) =>
        row(item) &&
        strings(item, ["id", "title", "meta", "sourceText", "abstractText", "fullText"]) &&
        coverage(item.coverage) &&
        ["verified", "unverified", "conflict"].includes(String(item.verify)) &&
        (item.version === undefined || (number(item.version) && Number(item.version) > 0)) &&
        (item.history === undefined ||
          list(
            item.history,
            (h) =>
              row(h) &&
              number(h.version) &&
              strings(h, ["at", "sourceText", "abstractText", "fullText", "note"]) &&
              ["verified", "unverified", "conflict"].includes(String(h.verify)),
          )),
    ) &&
    list(value.contextLiteratureIds, (id) => typeof id === "string") &&
    (value.templateBinding === null ||
      (row(value.templateBinding) && typeof value.templateBinding.materialId === "string" && number(value.templateBinding.version))) &&
    (value.citationRequest === null ||
      (row(value.citationRequest) &&
        list(value.citationRequest.ids, (id) => typeof id === "string") &&
        number(value.citationRequest.baseVersion) &&
        typeof value.citationRequest.text === "string" &&
        (value.citationRequest.sources === undefined || list(value.citationRequest.sources, source)))) &&
    (value.contextSources === undefined || list(value.contextSources, source)) &&
    (value.formatRequest === undefined ||
      value.formatRequest === null ||
      (row(value.formatRequest) &&
        strings(value.formatRequest, ["materialId", "label", "sourceText"]) &&
        number(value.formatRequest.templateVersion) &&
        number(value.formatRequest.baseVersion) &&
        value.formatRequest.operation === "normalize-headings" &&
        (value.formatRequest.align === undefined ||
          (typeof value.formatRequest.align === "string" && ["left", "center"].includes(value.formatRequest.align))) &&
        (value.formatRequest.fontWeight === undefined ||
          (typeof value.formatRequest.fontWeight === "string" && ["600", "700"].includes(value.formatRequest.fontWeight))))) &&
    (value.semanticChecks === undefined ||
      (row(value.semanticChecks) &&
        Object.values(value.semanticChecks).every(
          (s) =>
            row(s) &&
            ["running", "done", "failed", "cancelled"].includes(String(s.status)) &&
            number(s.inputVersion) &&
            number(s.requirementVersion) &&
            strings(s, ["explanation", "token"]) &&
            list(s.evidence, (x) => typeof x === "string"),
        )))
  );
}

export function currentLibraryVersion(material: LibraryMaterial) {
  return material.versions.find((item) => item.version === material.version) ?? material.versions[material.versions.length - 1]!;
}

export function addLibraryVersion(material: LibraryMaterial, patch: Partial<LibraryVersion>, reason: string) {
  const previous = currentLibraryVersion(material);
  const version = Math.max(...material.versions.map((item) => item.version)) + 1;
  const next = {
    ...previous,
    attempts: previous.attempts?.map((item) => ({ ...item })),
    templateItems: previous.templateItems?.map((item) => ({ ...item })),
    ...patch,
    version,
    reason,
    at: new Date().toLocaleString("zh-CN"),
  };
  material.versions.push(next);
  material.version = version;
  material.status = next.status;
  material.at = next.at;
  material.diagnosis = next.diagnosis;
  material.cancelled = false;
  return next;
}

export function libraryRequirementResult(item: LibraryRequirement, html: string, state?: LibraryState, documentVersion?: number): RequirementView {
  return evaluateLibraryRequirement(item, html, state, documentVersion);
}
