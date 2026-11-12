/** A leaving panel cannot keep accepting edits while its transition completes. */
const saved = new WeakMap<HTMLElement, boolean>();
function beforeLeave(element: Element) {
  if (!(element instanceof HTMLElement)) return;
  saved.set(element, element.inert);
  element.inert = true;
}
function restore(element: Element) {
  if (!(element instanceof HTMLElement)) return;
  element.inert = saved.get(element) ?? false;
  saved.delete(element);
}
export const panelMotionHooks = { onBeforeLeave: beforeLeave, onAfterLeave: restore, onLeaveCancelled: restore };
