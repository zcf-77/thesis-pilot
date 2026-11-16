<script setup lang="ts">
import { computed, ref, watch } from "vue";
import TpButton from "@/components/ui/TpButton.vue";
import { panelMotionHooks } from "@/lab/components/integration/motion";
import { listMotionHooks } from "@/design/motion";
import { bindingChoiceLabel, type SourceBindingState } from "./useSourceBinding";
import { materialTime } from "./materialPresentation";

/** Requirement-set binding inside the “论文要求” tab. Saves the whole snapshot with CAS through the shared state. */
const props = defineProps<{ state: SourceBindingState }>();
const selected = ref<string[]>([]);
const notice = ref("");
const undoTarget = ref<string[]>();
const requirementChoices = computed(() => props.state.choices.value.filter((item) => item.kind === "requirements"));
const missing = computed(() => selected.value.filter((id) => !props.state.choices.value.some((item) => item.id === id)));
const bound = computed(() => props.state.binding.value?.requirement_parse_version_ids ?? []);
const dirty = computed(() => selected.value.length !== bound.value.length || selected.value.some((id) => !bound.value.includes(id)));
const disabled = computed(() => props.state.busy.value || props.state.loading.value || props.state.optionLoading.value);

watch(
  () => props.state.binding.value,
  (binding) => {
    if (binding && !props.state.mustReload.value) selected.value = [...binding.requirement_parse_version_ids];
  },
  { immediate: true },
);

async function save(next = selected.value, undo = false) {
  const previous = [...bound.value];
  const latest = await props.state.save({ requirements: [...next] });
  if (!latest) return;
  selected.value = [...latest.requirement_parse_version_ids];
  undoTarget.value = undo ? undefined : previous;
  notice.value = undo ? `已恢复为上一组要求，当前绑定 v${latest.version}。` : `要求集已保存为绑定 v${latest.version}。`;
}
function reload() {
  notice.value = "";
  undoTarget.value = undefined;
  void props.state.load();
}
function toggleHistory(event: Event) {
  if ((event.target as HTMLDetailsElement).open && !props.state.history.value) void props.state.loadHistory();
}
</script>

<template>
  <section class="library-section-note" aria-label="要求集绑定">
    <p class="tp-subheading">要求有依据，判断有边界。</p>
    <p class="tp-caption mt-2">硬规则由程序检查，语义要求只给建议。绑定后的解析版本由助手与评审共用，新上传或重新解析不会自动替换。</p>
    <p v-if="state.loading.value || state.optionLoading.value" role="status" class="tp-caption mt-4">正在读取可绑定的要求版本…</p>
    <form v-if="state.binding.value" class="binding-form" @submit.prevent="save()">
      <fieldset class="binding-requirements" :disabled="disabled">
        <legend class="tp-label">要求集</legend>
        <p v-if="!requirementChoices.length && !missing.length && !state.optionLoading.value" class="tp-caption">
          暂无已解析的要求资料；上传“论文要求”并等待解析后可在这里绑定。
        </p>
        <TransitionGroup name="tp-list" tag="div" class="binding-options tp-list-group" v-bind="listMotionHooks"
          ><label v-for="item in requirementChoices" :key="item.id" class="binding-option"
            ><input v-model="selected" type="checkbox" class="tp-checkbox" :value="item.id" :aria-label="`绑定要求：${bindingChoiceLabel(item)}`" /><span>{{
              bindingChoiceLabel(item)
            }}</span></label
          ><label v-for="id in missing" :key="id" class="binding-option"
            ><input v-model="selected" type="checkbox" class="tp-checkbox" :value="id" /><span
              >{{ state.sourceLabel(id) }}<small>资料已解绑或移除，原绑定保留</small></span
            ></label
          ></TransitionGroup
        >
      </fieldset>
      <div class="screen-actions">
        <TpButton type="submit" size="sm" variant="primary" :loading="state.busy.value" :disabled="disabled || state.mustReload.value || !dirty"
          >保存要求集绑定</TpButton
        ><TpButton v-if="state.mustReload.value" size="sm" :disabled="state.loading.value" @click="reload">载入最新绑定</TpButton
        ><TpButton v-if="undoTarget && !dirty" size="sm" variant="ghost" :disabled="disabled" @click="save(undoTarget, true)">撤销本次绑定</TpButton
        ><span class="tp-caption">{{ state.binding.value.version ? `当前绑定 v${state.binding.value.version}` : "当前未绑定要求集" }}</span>
      </div>
    </form>
    <Transition name="tp-swap" v-bind="panelMotionHooks"
      ><p v-if="state.error.value" :key="state.error.value" role="alert" class="studio-notice mt-4">
        {{ state.error.value }}<TpButton v-if="!state.binding.value" size="sm" @click="reload">重试读取绑定</TpButton>
      </p></Transition
    >
    <p v-if="state.optionError.value" role="alert" class="studio-notice mt-4">
      {{ state.optionError.value }}<TpButton size="sm" @click="state.loadOptions()">重试读取可绑定版本</TpButton>
    </p>
    <Transition name="tp-swap" v-bind="panelMotionHooks"><p v-if="notice" :key="notice" role="status" class="tp-caption mt-3">{{ notice }}</p></Transition>
    <details v-if="state.binding.value?.version" class="binding-history mt-4" @toggle="toggleHistory">
      <summary>绑定历史</summary>
      <p v-if="state.historyBusy.value" role="status" class="tp-caption">正在读取绑定历史…</p>
      <p v-if="state.historyError.value" role="alert" class="studio-notice">
        {{ state.historyError.value }}<TpButton size="sm" @click="state.loadHistory(state.history.value?.offset ?? 0)">重试读取绑定历史</TpButton>
      </p>
      <div v-if="state.history.value" class="binding-history-list">
        <button
          v-for="item in state.history.value.items"
          :key="item.version"
          type="button"
          :aria-pressed="state.viewing.value?.version === item.version"
          :disabled="state.historyBusy.value"
          @click="state.viewHistory(item.version)"
        >
          <b>绑定 v{{ item.version }}</b><span>{{ materialTime(item.created_at) }}</span>
        </button>
      </div>
      <Transition name="tp-swap" mode="out-in" v-bind="panelMotionHooks"
        ><div v-if="state.viewing.value" :key="state.viewing.value.version" class="binding-snapshot">
          <p class="tp-label">只读快照 · v{{ state.viewing.value.version }}</p>
          <p>模板：{{ state.sourceLabel(state.viewing.value.template_parse_version_id) }}</p>
          <p v-for="id in state.viewing.value.requirement_parse_version_ids" :key="id">要求：{{ state.sourceLabel(id) }}</p>
          <p v-if="!state.viewing.value.requirement_parse_version_ids.length" class="tp-caption">未绑定要求</p>
        </div></Transition
      >
      <div v-if="state.history.value && state.history.value.total > 20" class="screen-actions">
        <TpButton
          size="sm"
          :disabled="state.historyBusy.value || state.history.value.offset === 0"
          @click="state.loadHistory(Math.max(0, state.history.value.offset - 20))"
          >上一页绑定</TpButton
        ><TpButton
          size="sm"
          :disabled="state.historyBusy.value || state.history.value.offset + state.history.value.items.length >= state.history.value.total"
          @click="state.loadHistory(state.history.value.offset + 20)"
          >下一页绑定</TpButton
        >
      </div>
    </details>
  </section>
</template>

<style scoped>
.library-section-note {
  padding: 24px;
  border-bottom: 1px solid var(--tp-line);
}
.binding-form {
  display: grid;
  gap: 16px;
  margin-top: 20px;
}
.binding-requirements {
  padding: 0;
  margin: 0;
  border: 0;
  min-width: 0;
}
.binding-requirements legend {
  margin-bottom: 12px;
}
.binding-options {
  display: grid;
  gap: 10px;
}
.binding-option {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  font-size: 13px;
  overflow-wrap: anywhere;
}
.binding-option input {
  flex-shrink: 0;
  margin-top: 2px;
}
.binding-option small {
  display: block;
  margin-top: 2px;
  color: var(--tp-text-muted);
  font-size: 11px;
}
.binding-history {
  font-size: 12px;
}
.binding-history-list {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 12px;
}
.binding-history-list button {
  display: grid;
  gap: 2px;
  padding: 8px 12px;
  text-align: left;
  border: 1px solid var(--tp-line);
  border-radius: var(--tp-radius-s);
}
.binding-history-list button[aria-pressed="true"] {
  border-color: var(--tp-accent);
  background: var(--tp-accent-soft);
}
.binding-history-list span {
  color: var(--tp-text-muted);
  font-size: 11px;
}
.binding-snapshot {
  display: grid;
  gap: 6px;
  margin-top: 12px;
  padding: 12px;
  border-left: 2px solid var(--tp-line-strong);
  overflow-wrap: anywhere;
}
@media (max-width: 640px) {
  .library-section-note {
    padding: 20px 16px;
  }
}
</style>
