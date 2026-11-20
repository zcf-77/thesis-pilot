<script setup lang="ts">
import { ref, watch } from "vue";
import TpButton from "@/components/ui/TpButton.vue";
import type { TaskVersionPage } from "@/services";
import { listMotionHooks } from "@/design/motion";
import { actionWord, statusWord } from "./taskBoard";

const props = defineProps<{ taskId: string; title: string; history?: TaskVersionPage; loading: boolean; error: string }>();
const open = defineModel<boolean>("open", { required: true });
const emit = defineEmits<{ retry: [] }>();
const viewing = ref<number>();
watch(
  () => props.taskId,
  () => {
    viewing.value = undefined;
  },
);
const time = (value: string) => value.slice(0, 16).replace("T", " ");
</script>

<template>
  <section class="screen-panel plan-history">
    <button class="plan-history__toggle" type="button" :aria-expanded="open" aria-controls="plan-history-body" @click="open = !open">
      <span class="tp-subheading">任务历史</span><span class="tp-caption">{{ history ? `${history.total} 条 · ` : "" }}{{ open ? "收起" : "展开" }}</span>
    </button>
    <Transition name="tp-swap">
      <div v-if="open" id="plan-history-body" class="plan-history__body" role="region" aria-label="任务历史">
        <Transition name="tp-swap" mode="out-in">
          <p v-if="loading && !history" key="loading" class="tp-caption" role="status">正在读取任务历史…</p>
          <div v-else-if="error" key="error" class="plan-history__error" role="alert">
            <span class="tp-caption">{{ error }}</span><TpButton size="sm" variant="ghost" @click="emit('retry')">重新读取历史</TpButton>
          </div>
          <div v-else-if="history" key="list">
            <p v-if="history.total > history.items.length" class="tp-caption">显示最近 {{ history.items.length }} / {{ history.total }} 条。</p>
            <TransitionGroup class="tp-list-group plan-history__list" name="tp-list" tag="ol" v-bind="listMotionHooks">
              <li v-for="entry in history.items" :key="entry.version">
                <button
                  type="button"
                  class="plan-history__entry"
                  :aria-expanded="viewing === entry.version"
                  @click="viewing = viewing === entry.version ? undefined : entry.version"
                >
                  <b>v{{ entry.version }} · {{ actionWord[entry.action] ?? entry.action }}</b
                  ><span class="tp-caption">{{ time(entry.created_at) }}{{ entry.reason ? ` · ${entry.reason}` : "" }}</span>
                </button>
                <Transition name="tp-swap">
                  <div v-if="viewing === entry.version" class="plan-snapshot">
                    <strong>{{ entry.snapshot.content.title }}</strong>
                    <p>验收：{{ entry.snapshot.content.acceptance }}</p>
                    <p class="tp-caption">{{ statusWord[entry.snapshot.status].label }} · {{ entry.snapshot.content.due_date ?? "未设截止" }}</p>
                    <p v-for="snapshot in entry.snapshot.evidence_snapshots" :key="snapshot.fingerprint" class="tp-caption">
                      {{ snapshot.label }}{{ snapshot.stale ? "（旧证据）" : "" }}
                    </p>
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
  flex-wrap: wrap;
  gap: 8px 16px;
  width: 100%;
  padding: 20px 24px;
  text-align: left;
}
.plan-history__toggle > .tp-caption {
  min-width: 0;
  overflow-wrap: anywhere;
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
  font-size: 13px;
  text-align: left;
  width: 100%;
}
.plan-history__entry:hover b {
  text-decoration: underline;
  text-underline-offset: 4px;
}
.plan-history__error {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
}
.plan-snapshot {
  display: grid;
  gap: 8px;
  margin-top: 12px;
  padding: 16px;
  background: var(--tp-surface-sunken);
  border-radius: var(--tp-radius-s);
  font-size: 13px;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
@media (max-width: 700px) {
  .plan-history__toggle {
    padding: 16px;
  }
  .plan-history__body {
    padding: 0 16px 16px;
  }
}
</style>
