<script setup lang="ts">
import { computed, onMounted, onScopeDispose, ref, shallowRef } from "vue";
import TpButton from "@/components/ui/TpButton.vue";
import { listMotionHooks } from "@/design/motion";
import type { BackendServices } from "@/services";
import type { LiteratureEntryRead } from "@/services/contracts/api.generated.ts";
import { asApiError } from "@/services/errors";
import { MAX_ASSISTANT_LITERATURE, assistantLiteratureScope, useAssistantLiterature, type PinnedLiterature } from "./assistantLiterature";
import { entryMeta } from "./citationView";

/** 内容助手固定上下文中的项目文献：题录与摘要按取得范围发送，全文从不发送。 */
const props = defineProps<{ services: BackendServices; projectId: string; disabled: boolean }>();
const model = defineModel<PinnedLiterature[]>({ required: true });
const store = useAssistantLiterature(() => assistantLiteratureScope(props.services.sourceKey, props.projectId));
const entries = shallowRef<LiteratureEntryRead[]>([]);
const loading = ref(false);
const error = ref("");
const limited = ref(false);
let request: AbortController | undefined;
const citable = computed(() => entries.value.filter((entry) => !entry.removed));

async function load() {
  request?.abort();
  const controller = new AbortController();
  request = controller;
  loading.value = true;
  error.value = "";
  try {
    const page = await props.services.literature.entries(props.projectId, { limit: 100 }, controller.signal);
    if (controller.signal.aborted) return;
    entries.value = page.items;
    store.sync(page.items);
    const known = new Map(page.items.filter((entry) => !entry.removed).map((entry) => [entry.id, entry]));
    const kept = model.value.filter((item) => known.has(item.entryId)).map((item) => ({ ...item, version: known.get(item.entryId)!.version }));
    model.value = kept.length || model.value.length ? kept : store.items.value.map((item) => ({ ...item }));
  } catch (problem) {
    if (!controller.signal.aborted) error.value = asApiError(problem).message;
  } finally {
    if (!controller.signal.aborted) loading.value = false;
  }
}
const checked = (id: string) => model.value.some((item) => item.entryId === id);
function toggle(entry: LiteratureEntryRead) {
  limited.value = false;
  if (checked(entry.id)) {
    model.value = model.value.filter((item) => item.entryId !== entry.id);
    store.remove(entry.id);
    return;
  }
  if (model.value.length >= MAX_ASSISTANT_LITERATURE) {
    limited.value = true;
    return;
  }
  model.value = [...model.value, { entryId: entry.id, version: entry.version, title: entry.record.title }];
  store.add(entry);
}
onMounted(() => void load());
onScopeDispose(() => request?.abort());
</script>

<template>
  <section class="assistant-literature studio-stack" aria-label="助手上下文中的项目文献">
    <div class="studio-row">
      <p class="tp-label">项目文献 · 已选 {{ model.length }}</p>
      <TpButton size="sm" variant="ghost" :disabled="disabled || loading" @click="load">刷新文献</TpButton>
    </div>
    <p class="tp-caption">仅使用题录与已取得的摘要。</p>
    <p v-if="loading" role="status" class="tp-caption">正在读取项目文献…</p>
    <p v-if="error" role="alert" class="studio-notice">{{ error }}</p>
    <p v-if="limited" role="alert" class="tp-caption">一次最多加入 {{ MAX_ASSISTANT_LITERATURE }} 篇文献。</p>
    <p v-if="!loading && !error && !citable.length" class="tp-caption">项目文献为空，可在资料页检索并保存。</p>
    <TransitionGroup tag="div" name="tp-list" v-bind="listMotionHooks" class="tp-list-group assistant-literature__list">
      <label v-for="entry in citable" :key="entry.id" class="assistant-literature__row">
        <input
          type="checkbox"
          class="checkbox checkbox-sm"
          :checked="checked(entry.id)"
          :disabled="disabled"
          :aria-label="`加入助手上下文：${entry.record.title}`"
          @change="toggle(entry)"
        />
        <span class="min-w-0">
          <b>{{ entry.record.title }}</b>
          <small>{{ entryMeta(entry) }} · {{ entry.record.coverage === "abstract" ? "题录与摘要" : "仅题录" }}</small>
        </span>
      </label>
    </TransitionGroup>
  </section>
</template>

<style scoped>
.assistant-literature {
  gap: 10px;
}
.assistant-literature__list {
  display: grid;
  gap: 6px;
}
.assistant-literature__row {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 8px 10px;
  border: 1px solid var(--tp-line);
  border-radius: var(--tp-radius-s);
  font-size: 12px;
  line-height: 1.6;
  cursor: pointer;
}
.assistant-literature__row input {
  flex-shrink: 0;
  margin-top: 2px;
}
.assistant-literature__row b {
  display: block;
  font-weight: 600;
  overflow-wrap: anywhere;
}
.assistant-literature__row small {
  display: block;
  color: var(--tp-text-muted);
  overflow-wrap: anywhere;
}
</style>
