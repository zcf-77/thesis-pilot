/** 阶段是有序列表：返回交换相邻两项后的新数组；越界时原样返回。依赖以阶段 ID 记录，不随顺序变化。 */
export function moveStage<T>(stages: readonly T[], index: number, offset: -1 | 1): T[] {
  const target = index + offset;
  const next = [...stages];
  if (index < 0 || index >= next.length || target < 0 || target >= next.length) return next;
  [next[index], next[target]] = [next[target]!, next[index]!];
  return next;
}
