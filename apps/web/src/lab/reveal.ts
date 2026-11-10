import type { ObjectDirective } from "vue";

/** v-reveal：元素进入视口时加上 .is-in（配合 .lab-reveal 做一次性揭示）。 */
let observer: IntersectionObserver | undefined;

function getObserver(): IntersectionObserver {
  observer ??= new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) {
          entry.target.classList.add("is-in");
          observer?.unobserve(entry.target);
        }
      }
    },
    { rootMargin: "0px 0px -8% 0px", threshold: 0.04 },
  );
  return observer;
}

export const vReveal: ObjectDirective<HTMLElement> = {
  mounted(el) {
    getObserver().observe(el);
  },
  unmounted(el) {
    observer?.unobserve(el);
  },
};
