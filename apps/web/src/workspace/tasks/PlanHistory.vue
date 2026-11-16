<script setup lang="ts">
import { onScopeDispose, ref, shallowRef, watch } from "vue";
import { PhArrowRight } from "@phosphor-icons/vue";
import TpButton from "@/components/ui/TpButton.vue";
import TpIcon from "@/components/ui/TpIcon.vue";
import { listMotionHooks } from "@/design/motion";
import type { BackendServices, PlanVersionPage } from "@/services";
import { asApiError } from "@/services/errors";
import { statusWord } from "./taskBoard";
import { planActionLabel, rangeLabel } from "./planView";

const props = defineProps<{ services: BackendServices; projectId: string; planVersion: number }>();
const open = ref(false);
const page = shallowRef<PlanVersionPage>();
const loading = ref(false);
const error = ref("");
const viewing = ref<number>();
let request: AbortController | undefined;

async function load() {
  request?.abort();
  const controller = new AbortController();
  request = controller;
  loading.value = true;
  error.value = "";
  try {
    const value = await props.services.plans.versions(props.projectId, { limit: 50 }, controller.signal);
    if (!controller.signal.aborted) page.value = value;
  } catch (issue) {
    if (!controller.signal.aborted) error.value = asApiError(issue).message;
  } finally {
    if (request === controller) loading.value = false;
  }
}
const time = (value: string) => {
  const date = new Date(value);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
};
watch(open, (value) => {
  if (value && !page.value) void load();
});
// A new plan version (adoption, revert or batch) refreshes an opened or already-read history.
watch(
  () => props.planVersion,
  () => {
    if (open.value || page.value) void load();
  },
);
watch(
  () => props.projectId,
  () => {
    request?.abort();
    page.value = undefined;
    viewing.value = undefined;
    if (open.value) void load();
  },
);
onScopeDispose(() => request?.abort());
</script>

<template>
  <section class="screen-panel plan-history">
    <button class="plan-history__toggle" type="button" :aria-expanded="open" aria-controls="plan-version-history" @click="open = !open">
      <span class="tp-subheading">计划历史</span
      ><span class="tp-caption">{{ planVersion ? `当前计划 v${planVersion}` : "尚无计划版本" }} · {{ open ? "收起" : "展开" }}</span>
    </button>
    <Transition name="tp-swap">
      <div v-if="open" id="plan-version-history" class="plan-history__body" role="region" aria-label="计划历史">
        <Transition name="tp-swap" mode="out-in">
          <p v-if="loading && !page" key="loading" class="tp-caption" role="status">正在读取计划历史…</p>
          <div v-else-if="error" key="error" class="plan-history__error" role="alert">
            <span class="tp-caption">{{ error }}</span><TpButton size="sm" variant="ghost" @click="load">重新读取历史</TpButton>
          </div>
          <p v-else-if="page && !page.items.length" key="empty" class="tp-caption">还没有计划版本。采纳 AI 调整或撤销采纳时，会在这里留下整份计划的快照。</p>
          <div v-else-if="page" key="list">
            <p v-if="page.total > page.items.length" class="tp-caption">显示最近 {{ page.items.length }} / {{ page.total }} 个版本。</p>
            <TransitionGroup class="tp-list-group plan-history__list" name="tp-list" tag="ol" v-bind="listMotionHooks">
              <li v-for="entry in page.items" :key="entry.version">
                <button
                  type="button"
                  class="plan-history__entry"
                  :aria-expanded="viewing === entry.version"
                  @click="viewing = viewing === entry.version ? undefined : entry.version"
                >
                  <b>v{{ entry.version }} · {{ planActionLabel[entry.action] }}</b
                  ><span class="tp-caption"
                    >{{ time(entry.created_at) }} · {{ entry.changes.length }} 项任务{{ entry.reason ? ` · ${entry.reason}` : "" }}</span
                  >
                </button>
                <Transition name="tp-swap">
                  <div v-if="viewing === entry.version" class="plan-snapshot">
                    <ul class="plan-history__changes" aria-label="本次变化">
                      <li v-for="change in entry.changes" :key="change.task_id">
                        <span>{{ change.title }}</span
                        ><span class="plan-history__dates"
                          ><s class="tp-mono">{{ rangeLabel(change.before.start_date, change.before.due_date) }}</s><TpIcon :icon="PhArrowRight" :size="13" /><b
                            class="tp-mono"
                            >{{ rangeLabel(change.after.start_date, change.after.due_date) }}</b
                          ></span
                        >
                      </li>
                    </ul>
                    <details class="tp-disclosure">
                      <summary class="tp-caption plan-history__more">查看当时任务安排（{{ entry.tasks.filter((task) => !task.archived).length }} 项）</summary>
                      <ul class="plan-history__tasks">
                        <li v-for="task in entry.tasks.filter((item) => !item.archived)" :key="task.task_id">
                          <span>{{ task.title }}</span
                          ><span class="tp-caption">{{ rangeLabel(task.start_date, task.due_date) }} · {{ statusWord[task.status].label }}</span>
                        </li>
                      </ul>
                    </details>
                  </div>
                </Transition>
              </li>
            </TransitionGroup>
          </div>
        </Transition>
      </div>
    </Transition>
  </section>
</template>

<style scoped>
.plan-history__toggle {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  width: 100%;
  padding: 20px 24px;
  text-align: left;
}
.plan-history__body {
  padding: 0 24px 24px;
}
.plan-history__list {
  display: grid;
  gap: 16px;
}
.plan-history__entry {
  display: grid;
  gap: 4px;
  text-align: left;
  font-size: 13px;
  width: 100%;
}
.plan-history__entry:hover b {
  text-decoration: underline;
  text-underline-offset: 4px;
}
.plan-history__error {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
}
.plan-snapshot {
  display: grid;
  gap: 12px;
  margin-top: 12px;
  padding: 12px 16px;
  background: var(--tp-surface-sunken);
  border-radius: var(--tp-radius-sm);
}
.plan-history__changes,
.plan-history__tasks {
  display: grid;
  gap: 8px;
  font-size: 13px;
}
.plan-history__changes li,
.plan-history__tasks li {
  display: flex;
  flex-wrap: wrap;
  justify-content: space-between;
  gap: 4px 12px;
}
.plan-history__dates {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}
.plan-history__dates s {
  color: var(--tp-text-muted);
}
.plan-history__more {
  cursor: pointer;
  text-decoration: underline;
  text-underline-offset: 4px;
}
.plan-history__tasks {
  margin-top: 8px;
}
@media (max-width: 700px) {
  .plan-history__toggle {
    padding: 16px;
    flex-wrap: wrap;
  }
  .plan-history__body {
    padding: 0 16px 16px;
  }
}
</style>
