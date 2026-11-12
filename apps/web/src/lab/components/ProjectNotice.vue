<script setup lang="ts">
import TpDatePicker from "@/components/ui/TpDatePicker.vue";
import { computed, ref, useId, watch } from "vue";
import { PhBellRinging } from "@phosphor-icons/vue";
import TpIcon from "@/components/ui/TpIcon.vue";
import TpButton from "@/components/ui/TpButton.vue";
import { useInboxState, updateSuggestion } from "../state/inboxState";

/** L3只供今日/计划挂载；只改变建议状态，不采纳计划、不确认任务。 */
const state = useInboxState();
const pending = computed(() => state.value.suggestions.filter((item) => item.state === "unread" && item.level === "L3"));
const notice = computed(() => pending.value[0]);
const snoozing = ref(false);
const until = ref("");
const error = ref("");
const dateId = useId();
watch(
  () => notice.value?.id,
  () => {
    snoozing.value = false;
    error.value = "";
  },
);
function openSnooze() {
  const next = new Date(Date.now() + 86400000);
  next.setMinutes(next.getMinutes() - next.getTimezoneOffset());
  until.value = next.toISOString().slice(0, 16);
  snoozing.value = true;
  error.value = "";
}
function snooze() {
  if (!notice.value) return;
  if (!until.value || Number.isNaN(Date.parse(until.value)) || Date.parse(until.value) <= Date.now()) {
    error.value = "请选择未来的延后截止时间。";
    return;
  }
  error.value = updateSuggestion(state.value, notice.value, "snoozed", until.value);
}
function dismiss() {
  if (notice.value) updateSuggestion(state.value, notice.value, "dismissed");
}
function view() {
  if (notice.value) updateSuggestion(state.value, notice.value, "read");
}
</script>

<template>
  <Transition name="tp-swap" mode="out-in">
    <section :key="notice.id" v-if="notice" class="project-notice" aria-label="重要进度提醒">
      <div class="project-notice__icon"><TpIcon :icon="PhBellRinging" :size="20" /></div>
      <div class="project-notice__content">
        <p class="tp-label">进度提醒</p>
        <h2 class="tp-subheading">{{ notice.title }}</h2>
        <p class="tp-caption project-notice__basis">{{ notice.basis }}</p>
        <p class="tp-caption">{{ notice.uncertainty }}</p>
        <Transition name="tp-swap">
          <form v-if="snoozing" class="project-notice__form" @submit.prevent="snooze" @keydown.esc="snoozing = false">
            <label :for="dateId" class="tp-label">延后截止时间</label>
            <TpDatePicker :id="dateId" v-model="until" type="datetime-local" required />
            <div class="screen-actions">
              <TpButton size="sm" type="submit" variant="primary">保存延后时间</TpButton
              ><TpButton size="sm" variant="ghost" @click="snoozing = false">取消</TpButton>
            </div>
            <Transition name="tp-swap" mode="out-in">
              <p :key="error" v-if="error" role="alert" class="project-notice__error tp-caption">{{ error }}</p>
            </Transition>
          </form>
        </Transition>
      </div>
      <div class="project-notice__actions">
        <RouterLink :to="notice.route" class="tp-btn tp-btn--outline tp-btn--sm" @click="view">查看来源 ↗</RouterLink>
        <TpButton size="sm" variant="ghost" @click="openSnooze">延后</TpButton>
        <TpButton size="sm" variant="ghost" @click="dismiss">忽略</TpButton>
        <RouterLink v-if="pending.length > 1" to="/screens/inbox" class="studio-link tp-caption">另有 {{ pending.length - 1 }} 条</RouterLink>
      </div>
    </section>
  </Transition>
</template>

<style scoped>
.project-notice {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  align-items: start;
  gap: 16px;
  padding: 18px 20px;
  border: 1px solid var(--tp-line);
  border-left: 3px solid var(--tp-accent);
  border-radius: var(--tp-radius-m);
  background: var(--tp-surface);
}
.project-notice__icon {
  color: var(--tp-accent);
  padding-top: 3px;
}
.project-notice__content {
  min-width: 0;
  overflow-wrap: anywhere;
}
.project-notice__content h2 {
  margin-top: 5px;
}
.project-notice__basis {
  margin: 8px 0 4px;
}
.project-notice__actions {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
  justify-content: flex-end;
  max-width: 300px;
}
.project-notice__form {
  display: grid;
  gap: 8px;
  margin-top: 16px;
  max-width: 390px;
}
.project-notice__form input {
  min-width: 0;
}
.project-notice__error {
  color: var(--tp-danger);
}
@media (max-width: 960px) {
  .project-notice {
    grid-template-columns: auto minmax(0, 1fr);
  }
  .project-notice__actions {
    grid-column: 2;
    justify-content: flex-start;
    max-width: none;
  }
}
@media (max-width: 480px) {
  .project-notice {
    padding: 14px;
    gap: 12px;
  }
}
</style>
