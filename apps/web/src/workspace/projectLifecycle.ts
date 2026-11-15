/** Draft rules shared by the formal project and flow editors. */
export interface LifecycleStage {
  id: string;
  name: string;
  description: string;
  deliverables: string[];
  conditions: string[];
  dependencies: string[];
  enabled: boolean;
  start: string | null;
  deadline: string | null;
}

export function lines(value: string): string[] {
  return value
    .split(/\r?\n/)
    .map((item) => item.trim())
    .filter(Boolean);
}

export function newStage(): LifecycleStage {
  return { id: crypto.randomUUID(), name: "", description: "", deliverables: [], conditions: [], dependencies: [], enabled: true, start: null, deadline: null };
}

type StageInput = Pick<LifecycleStage, "id" | "name" | "deliverables" | "conditions"> & Partial<LifecycleStage>;

export function cloneStages(stages: readonly StageInput[]): LifecycleStage[] {
  return stages.map((stage) => ({
    ...stage,
    description: stage.description ?? "",
    enabled: stage.enabled ?? true,
    start: stage.start ?? null,
    deadline: stage.deadline ?? null,
    deliverables: [...stage.deliverables],
    conditions: [...stage.conditions],
    dependencies: [...(stage.dependencies ?? [])],
  }));
}

export function removeStage(stages: readonly LifecycleStage[], id: string): LifecycleStage[] {
  return cloneStages(stages.filter((stage) => stage.id !== id)).map((stage) => ({
    ...stage,
    dependencies: stage.dependencies.filter((dependency) => dependency !== id),
  }));
}

export function flowDraftError(name: string, stages: readonly LifecycleStage[]): string {
  if (!name.trim() || Array.from(name.trim()).length > 200) return "请输入 1 至 200 个字符的流程名称。";
  if (!stages.length) return "请至少添加一个阶段。";
  const ids = new Set(stages.map((stage) => stage.id));
  if (ids.size !== stages.length || stages.some((stage) => !stage.id)) return "阶段标识重复或为空，请重新添加该阶段。";
  if (new Set(stages.map((stage) => stage.name.trim())).size !== stages.length) return "阶段名称不能重复。";
  if (!stages.some((stage) => stage.enabled)) return "请至少保留一个启用中的阶段。";
  for (const stage of stages) {
    if (!stage.name.trim() || Array.from(stage.name.trim()).length > 200) return "每个阶段都需要 1 至 200 个字符的名称。";
    if (stage.dependencies.some((id) => !ids.has(id) || id === stage.id)) return `“${stage.name}”的前置依赖无效。`;
    if (stage.start && stage.deadline && stage.start > stage.deadline) return `“${stage.name}”的截止日期不能早于开始日期。`;
    if (stage.enabled && (!stage.deliverables.length || !stage.conditions.length)) return `请为“${stage.name}”填写交付物和阶段条件。`;
    for (const dependency of stage.dependencies) {
      const prerequisite = stages.find((item) => item.id === dependency);
      if (stage.enabled && prerequisite && !prerequisite.enabled) return `“${stage.name}”不能依赖已停用阶段。`;
      if (stage.enabled && stage.deadline && prerequisite?.deadline && stage.deadline < prerequisite.deadline)
        return `“${stage.name}”的截止日期不能早于前置阶段。`;
    }
  }
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const byId = new Map(stages.map((stage) => [stage.id, stage]));
  function cycle(id: string): boolean {
    if (visiting.has(id)) return true;
    if (visited.has(id)) return false;
    visiting.add(id);
    if (byId.get(id)!.dependencies.some(cycle)) return true;
    visiting.delete(id);
    visited.add(id);
    return false;
  }
  return stages.some((stage) => cycle(stage.id)) ? "前置依赖形成循环，请调整后保存。" : "";
}

export function projectBindingError(versionId: string, stageId: string, stages: readonly Pick<StageInput, "id" | "enabled">[]): string {
  if (!versionId && stageId) return "请先选择流程版本。";
  if (versionId && (!stageId || !stages.some((stage) => stage.id === stageId && (stage.enabled ?? true)))) return "请选择该版本中的有效阶段。";
  return "";
}
