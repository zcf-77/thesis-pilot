export interface SelectOption {
  value: string | number;
  label: string;
  description?: string;
  disabled?: boolean;
  group?: string;
}

export interface SelectPresence {
  run: number;
  phase: "hidden" | "entering" | "shown" | "leaving";
}

/** Late completion from an interrupted exit must never hide a newly opened popup. */
export function selectPresenceTransition(state: SelectPresence, intent: "open" | "close" | "destroy" | { complete: number }): SelectPresence {
  if (typeof intent === "object") {
    if (intent.complete !== state.run) return state;
    return { ...state, phase: state.phase === "leaving" ? "hidden" : state.phase === "entering" ? "shown" : state.phase };
  }
  if (intent === "destroy") return { run: state.run + 1, phase: "hidden" };
  if (intent === "open") return { run: state.run + 1, phase: "entering" };
  return state.phase === "hidden" || state.phase === "leaving" ? state : { run: state.run + 1, phase: "leaving" };
}

export function selectMotionPlan(
  phase: "enter" | "leave",
  style: { duration: string; easing: string; enterTransform: string; enterFilter: string },
  reduced: boolean,
  from?: { opacity: string; transform: string; filter: string },
): { frames: Keyframe[]; timing: KeyframeAnimationOptions } {
  const firstDuration = style.duration.split(",")[0]!.trim();
  const parsed = Number.parseFloat(firstDuration) * (firstDuration.endsWith("ms") ? 1 : 1000);
  const duration = Number.isFinite(parsed) ? Math.max(0, parsed) : phase === "enter" ? 180 : 120;
  const frames: Keyframe[] = [{ opacity: from?.opacity ?? (phase === "enter" ? "0" : "1") }, { opacity: phase === "enter" ? "1" : "0" }];
  if (!reduced) {
    frames[0]!.transform = from?.transform ?? (phase === "enter" ? style.enterTransform || "none" : "none");
    frames[0]!.filter = from?.filter ?? (phase === "enter" ? style.enterFilter || "none" : "none");
    frames[1]!.transform = phase === "enter" ? "none" : style.enterTransform || "none";
    frames[1]!.filter = phase === "enter" ? "none" : style.enterFilter || "none";
  }
  return { frames, timing: { duration: reduced ? Math.min(120, duration) : duration, easing: reduced ? "linear" : style.easing || "ease", fill: "both" } };
}

export function filterSelectOptions(options: readonly SelectOption[], query: string): SelectOption[] {
  const words = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  return options.filter((option) => {
    const text = `${option.label} ${option.description ?? ""} ${option.group ?? ""}`.toLocaleLowerCase();
    return words.every((word) => text.includes(word));
  });
}

/** Skip disabled entries and wrap once; empty/fully disabled lists have no active option. */
export function nextSelectIndex(options: readonly SelectOption[], from: number, direction: 1 | -1): number {
  for (let step = 1; step <= options.length; step += 1) {
    const index = (from + direction * step + options.length * 2) % options.length;
    if (!options[index]?.disabled) return index;
  }
  return -1;
}

export function typeaheadSelectIndex(options: readonly SelectOption[], query: string, from: number): number {
  const normalized = query.toLocaleLowerCase();
  for (let step = 1; step <= options.length; step += 1) {
    const index = (from + step + options.length) % options.length;
    const option = options[index];
    if (option && !option.disabled && option.label.toLocaleLowerCase().startsWith(normalized)) return index;
  }
  return -1;
}

/** Position measured in viewport coordinates; the popup is painted in the browser top layer. */
export function selectPopoverPosition(
  anchor: { left: number; top: number; bottom: number; width: number },
  viewport: { width: number; height: number },
  naturalHeight: number,
) {
  const gutter = 12;
  const gap = 7;
  const width = Math.min(Math.max(anchor.width, 248), Math.max(0, viewport.width - gutter * 2));
  const below = viewport.height - anchor.bottom - gap - gutter;
  const above = anchor.top - gap - gutter;
  const side = below >= Math.min(naturalHeight, 240) || below >= above ? "bottom" : "top";
  const maxHeight = Math.max(0, Math.min(392, side === "bottom" ? below : above));
  const height = Math.min(naturalHeight, maxHeight);
  const top = side === "bottom" ? Math.min(anchor.bottom + gap, viewport.height - height - gutter) : anchor.top - gap - height;
  return {
    left: Math.max(gutter, Math.min(anchor.left, viewport.width - width - gutter)),
    top: Math.max(gutter, top),
    width,
    maxHeight,
    side,
  };
}
