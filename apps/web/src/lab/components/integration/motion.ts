/** A leaving panel cannot keep accepting edits while its transition completes. */
const saved = new WeakMap<HTMLElement, { inert: boolean; hidden: string | null }>();
function beforeLeave(element: Element) {
  if (!(element instanceof HTMLElement)) return;
  saved.set(element, { inert: element.inert, hidden: element.getAttribute("aria-hidden") });
  element.inert = true;
  element.setAttribute("aria-hidden", "true");
}
function restore(element: Element) {
  if (!(element instanceof HTMLElement)) return;
  const previous = saved.get(element);
  element.inert = previous?.inert ?? false;
  if (previous?.hidden == null) element.removeAttribute("aria-hidden");
  else element.setAttribute("aria-hidden", previous.hidden);
  saved.delete(element);
}
export const panelMotionHooks = { onBeforeLeave: beforeLeave, onAfterLeave: restore, onLeaveCancelled: restore };
