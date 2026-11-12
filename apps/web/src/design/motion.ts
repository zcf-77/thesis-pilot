/** TransitionGroup 离场冻结几何尺寸，避免多列卡片被 width:100% 拉满。 */
const leaving = new WeakMap<HTMLElement, { style: Record<string, string>; inert: boolean; hidden: string | null }>();
const properties = ["width", "height", "left", "top", "box-sizing"];

function beforeLeave(element: Element) {
  if (!(element instanceof HTMLElement) || !element.parentElement) return;
  const parent = element.parentElement;
  const box = element.getBoundingClientRect();
  const parentBox = parent.getBoundingClientRect();
  const style = getComputedStyle(element);
  leaving.set(element, {
    style: Object.fromEntries(properties.map((name) => [name, element.style.getPropertyValue(name)])),
    inert: element.inert,
    hidden: element.getAttribute("aria-hidden"),
  });
  element.style.width = `${box.width}px`;
  element.style.height = `${box.height}px`;
  element.style.boxSizing = "border-box";
  element.style.left = `${box.left - parentBox.left + parent.scrollLeft - parent.clientLeft - parseFloat(style.marginLeft || "0")}px`;
  element.style.top = `${box.top - parentBox.top + parent.scrollTop - parent.clientTop - parseFloat(style.marginTop || "0")}px`;
  element.inert = true;
  element.setAttribute("aria-hidden", "true");
}
function restore(element: Element) {
  if (!(element instanceof HTMLElement)) return;
  const saved = leaving.get(element);
  if (!saved) return;
  for (const [key, value] of Object.entries(saved.style)) {
    if (value) element.style.setProperty(key, value);
    else element.style.removeProperty(key);
  }
  element.inert = saved.inert;
  if (saved.hidden === null) element.removeAttribute("aria-hidden");
  else element.setAttribute("aria-hidden", saved.hidden);
  leaving.delete(element);
}
export const listMotionHooks = { onBeforeLeave: beforeLeave, onAfterLeave: restore, onLeaveCancelled: restore };
