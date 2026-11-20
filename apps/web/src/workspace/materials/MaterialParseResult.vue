<script setup lang="ts">
import { computed, nextTick, ref, useId, watch } from "vue";
import { PhArrowDown, PhBookOpen } from "@phosphor-icons/vue";
import TpButton from "@/components/ui/TpButton.vue";
import TpIcon from "@/components/ui/TpIcon.vue";
import TpStatus from "@/components/ui/TpStatus.vue";
import type { BackendServices } from "@/services";
import { listMotionHooks } from "@/design/motion";
import { panelMotionHooks } from "@/lab/components/integration/motion";
import { highlightParts, materialFragments, matchesQuery, templateField, templateScope, templateValue } from "./materialPresentation";
import type { SourceBindingState } from "./useSourceBinding";

const props = defineProps<{
  parsed: Awaited<ReturnType<BackendServices["materials"]["parse"]>>;
  kind: string;
  query: string;
  binding: SourceBindingState;
  available: boolean;
}>();
const result = computed(() => props.parsed.result);
const open = ref(true);
const shown = ref(20);
const focused = ref("");
const prefix = useId();
const notice = ref("");
const undoTemplate = ref<string | null>();
const fragments = computed(() => materialFragments(result.value));
const visible = computed(() => fragments.value.filter((item) => matchesQuery(item.text, props.query)));
const templateBound = computed(() => props.binding.binding.value?.template_parse_version_id === props.parsed.id);
const requirementBound = computed(() => props.binding.binding.value?.requirement_parse_version_ids.includes(props.parsed.id) ?? false);
const stateLabel = { recognized: "已识别", unknown: "未识别", conflict: "互相冲突" } as const;
const stateTone = { recognized: "success", unknown: "ghost", conflict: "warning" } as const;
async function focusAnchor(id: string) {
  const index = visible.value.findIndex((item) => item.id === id);
  if (index < 0) {
    focused.value = id;
    return;
  }
  open.value = true;
  shown.value = Math.max(shown.value, index + 1);
  focused.value = id;
  await nextTick();
  document.getElementById(`${prefix}-${id}`)?.scrollIntoView({ block: "nearest" });
}
async function bindTemplate(target: string | null, undo = false) {
  const previous = props.binding.binding.value?.template_parse_version_id ?? null;
  const latest = await props.binding.save({ template: target });
  if (!latest) return;
  undoTemplate.value = undo ? undefined : previous;
  notice.value = undo
    ? `已恢复原模板绑定，当前为绑定 v${latest.version}。`
    : target
      ? `此模板版本已绑定到项目（绑定 v${latest.version}）。`
      : `已解除模板绑定（绑定 v${latest.version}）。`;
}
watch(
  () => props.parsed.id,
  () => {
    shown.value = 20;
    focused.value = "";
    notice.value = "";
    undoTemplate.value = undefined;
  },
);
watch(
  () => props.query,
  () => (shown.value = 20),
);
</script>

<template>
  <div class="material-result">
    <details v-if="result.diagnostics.length" class="library-diagnostics tp-disclosure">
      <summary>{{ result.status === "partial" ? "未识别内容与解析说明" : "解析说明" }}（{{ result.diagnostics.length }}）</summary>
      <ul>
        <li v-for="(diagnostic, index) in result.diagnostics" :key="`${index}:${diagnostic}`">{{ diagnostic }}</li>
      </ul>
    </details>
    <button type="button" class="library-excerpt-toggle" :aria-expanded="open" :aria-controls="`${prefix}-excerpt`" @click="open = !open">
      <span><TpIcon :icon="PhBookOpen" :size="16" />提取文本</span>
      <span class="tp-caption"
        >解析 v{{ parsed.version }} · {{ fragments.length }} 段<TpIcon :icon="PhArrowDown" :size="14" :class="{ 'is-open': open }"
      /></span>
    </button>
    <Transition name="tp-swap" v-bind="panelMotionHooks">
      <section v-show="open" :id="`${prefix}-excerpt`" class="library-excerpt" aria-label="解析结果">
        <p v-if="!fragments.length" class="tp-caption">本解析版本没有可读文本；可下载原件核对。</p>
        <p v-else-if="!visible.length" class="tp-caption">没有包含“{{ query }}”的片段。</p>
        <TransitionGroup name="tp-list" tag="div" class="library-fragments tp-list-group" v-bind="listMotionHooks">
          <article
            v-for="fragment in visible.slice(0, shown)"
            :id="`${prefix}-${fragment.id}`"
            :key="fragment.id"
            class="library-fragment"
            :class="{ 'is-focused': focused === fragment.id }"
          >
            <span class="tp-label">{{ fragment.label }}<template v-if="!fragment.editable"> · 受保护对象</template></span>
            <details v-if="fragment.markup" class="fragment-markup tp-disclosure">
              <summary>查看来源标记</summary>
              <blockquote class="is-markup">
                <template v-for="(part, index) in highlightParts(fragment.text, query)" :key="index">
                  <mark v-if="part.match">{{ part.text }}</mark><template v-else>{{ part.text }}</template>
                </template>
              </blockquote>
            </details>
            <blockquote v-else>
              <template v-for="(part, index) in highlightParts(fragment.text, query)" :key="index">
                <mark v-if="part.match">{{ part.text }}</mark><template v-else>{{ part.text }}</template>
              </template>
            </blockquote>
          </article>
        </TransitionGroup>
        <TpButton v-if="shown < visible.length" size="sm" @click="shown += 20">查看更多片段（{{ shown }}/{{ visible.length }}）</TpButton>
      </section>
    </Transition>

    <section v-if="kind === 'template'" :id="`${prefix}-template`" class="library-template" aria-label="模板结构与支持范围">
      <h3 class="tp-subheading">模板结构与支持范围</h3>
      <dl v-if="result.template_items.length" class="library-definition">
        <template v-for="(item, index) in result.template_items" :key="item.id">
          <dt>{{ templateField(item.field) }}<small>{{ templateScope(item.scope) }}</small></dt>
          <dd>
            <b>{{ templateValue(item) }}</b>
            <TpStatus :tone="stateTone[item.state]" :label="stateLabel[item.state]" size="sm" />
            <small v-if="item.note && item.note !== result.template_items[index - 1]?.note">{{ item.note }}</small>
            <span v-if="item.anchor_ids.length" class="library-anchor-links">
              <button v-for="(id, n) in item.anchor_ids" :key="id" type="button" @click="focusAnchor(id)">来源 {{ n + 1 }}</button>
            </span>
          </dd>
        </template>
      </dl>
      <p v-else class="tp-ghost library-detail-note">未提取到可核验的模板格式项，不能判为完整支持。</p>
      <div class="screen-actions">
        <TpButton
          v-if="!templateBound"
          size="sm"
          :disabled="!available || !binding.binding.value || binding.busy.value || binding.mustReload.value"
          :loading="binding.busy.value"
          @click="bindTemplate(parsed.id)"
          >绑定此模板版本</TpButton
        >
        <TpButton v-else size="sm" variant="ghost" :disabled="binding.busy.value || binding.mustReload.value" @click="bindTemplate(null)">
          解除模板绑定
        </TpButton>
        <TpButton v-if="undoTemplate !== undefined" size="sm" variant="ghost" :disabled="binding.busy.value" @click="bindTemplate(undoTemplate, true)">
          撤销模板绑定
        </TpButton>
        <TpButton v-if="binding.mustReload.value" size="sm" @click="binding.load()">载入最新绑定</TpButton>
      </div>
      <p v-if="templateBound" class="tp-caption">当前项目模板 · 绑定 v{{ binding.binding.value?.version }}</p>
      <p v-else-if="!available" class="tp-caption">恢复项目关联后才能绑定此版本。</p>
      <Transition name="tp-swap" v-bind="panelMotionHooks"><p v-if="notice" :key="notice" role="status" class="tp-caption">{{ notice }}</p></Transition>
      <p class="tp-caption">绑定固定解析版本，不修改正文。</p>
    </section>

    <section v-if="kind === 'requirements'" :id="`${prefix}-requirements`" class="library-template" aria-label="提取要求">
      <div class="library-detail-status">
        <h3 class="tp-subheading">提取要求</h3>
        <TpStatus :tone="requirementBound ? 'success' : 'neutral'" :label="requirementBound ? '已在要求集' : '未绑定'" size="sm" />
      </div>
      <p v-if="!result.requirements.length" class="tp-ghost library-detail-note">未提取到要求；原文仍可供核对。</p>
      <TransitionGroup name="tp-list" tag="div" class="library-fragments tp-list-group" v-bind="listMotionHooks">
        <article v-for="item in result.requirements" :key="item.id" class="library-requirement">
          <blockquote>{{ item.original_text }}</blockquote>
          <p class="tp-caption">
            {{ templateScope(item.scope) }} · {{ item.rule_type === "hard" ? "程序规则" : "语义建议" }} ·
            {{ item.checkable ? "可程序核对" : "暂不可程序判定" }} ·
            {{ item.strictness === "required" ? "必需" : item.strictness === "suggested" ? "建议" : "约束未知" }}
          </p>
          <dl v-if="Object.keys(item.parameters ?? {}).length" class="requirement-parameters">
            <template v-for="(value, key) in item.parameters" :key="key"
              ><dt>{{ key }}</dt>
              <dd>{{ value }}</dd></template
            >
          </dl>
          <p v-if="item.uncertainty" class="tp-ghost library-detail-note">{{ item.uncertainty }}</p>
          <span v-if="item.anchor_ids.length" class="library-anchor-links">
            <button v-for="(id, index) in item.anchor_ids" :key="id" type="button" @click="focusAnchor(id)">要求来源 {{ index + 1 }}</button>
          </span>
        </article>
      </TransitionGroup>
    </section>
  </div>
</template>

<style scoped>
.material-result {
  display: grid;
  gap: 20px;
  min-width: 0;
  padding-top: 20px;
  border-top: 1px solid var(--tp-line);
}
.library-detail-note {
  padding: 12px;
  font-size: 12px;
  line-height: 1.7;
  overflow-wrap: anywhere;
}
.library-diagnostics {
  font-size: 12px;
  color: var(--tp-text-muted);
}
.library-diagnostics ul {
  display: grid;
  gap: 8px;
  margin: 12px 0 0;
  padding-left: 20px;
  overflow-wrap: anywhere;
}
.library-detail-status {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 8px;
}
.library-excerpt-toggle {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  font-weight: 600;
  font-size: 13px;
  width: 100%;
  min-height: 36px;
}
.library-excerpt-toggle > span {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
}
.library-excerpt-toggle > span:last-child {
  justify-content: flex-end;
  color: var(--tp-text-muted);
  font-weight: 400;
}
.library-excerpt-toggle :deep(.is-open) {
  transform: rotate(180deg);
}
.library-excerpt {
  border-left: 2px solid var(--tp-line-strong);
  padding-left: 16px;
  min-width: 0;
}
.library-fragments {
  display: grid;
  gap: 4px;
}
.library-fragment {
  padding: 8px 0;
  scroll-margin-top: 88px;
  border-radius: var(--tp-radius-xs);
}
.library-fragment.is-focused {
  outline: 1px solid var(--tp-focus);
  outline-offset: 4px;
}
blockquote {
  margin: 8px 0;
  white-space: pre-line;
  overflow-wrap: anywhere;
  font-family: var(--tp-font-prose);
  font-size: 14px;
  line-height: 1.9;
}
.library-fragment blockquote {
  margin: 4px 0 0;
}
.fragment-markup {
  margin-top: 4px;
  font-family: var(--tp-font-body);
  font-size: 11px;
}
.library-fragment blockquote.is-markup {
  font-family: var(--tp-font-mono);
  font-size: 11px;
  line-height: 1.5;
  color: var(--tp-text-muted);
  overflow-wrap: anywhere;
  word-break: break-word;
}
mark {
  background: var(--tp-highlight);
  color: inherit;
  border-radius: var(--tp-radius-xs);
}
.library-template {
  display: grid;
  gap: 12px;
  padding-top: 20px;
  border-top: 1px solid var(--tp-line);
  scroll-margin-top: 88px;
}
.library-definition {
  display: grid;
  grid-template-columns: 96px minmax(0, 1fr);
  font-size: 12px;
}
.library-definition dt,
.library-definition dd {
  padding: 12px 0;
  border-bottom: 1px solid var(--tp-line);
  min-width: 0;
  overflow-wrap: anywhere;
}
.library-definition dt {
  color: var(--tp-text-muted);
}
.library-definition dd {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px 8px;
}
.library-definition small {
  display: block;
  width: 100%;
  color: var(--tp-text-muted);
}
.library-definition dt small {
  margin-top: 4px;
}
.library-requirement {
  padding: 12px 0;
  border-bottom: 1px solid var(--tp-line);
  overflow-wrap: anywhere;
}
.library-requirement blockquote {
  margin-top: 0;
}
.requirement-parameters {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 12px;
  margin: 8px 0;
  font-size: 12px;
}
.requirement-parameters dt {
  color: var(--tp-text-muted);
}
.requirement-parameters dd {
  margin: 0;
  overflow-wrap: anywhere;
}
.library-anchor-links {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 12px;
  width: 100%;
}
.library-anchor-links button {
  min-height: 28px;
  font-size: 11px;
  color: var(--tp-text-muted);
  text-decoration: underline;
  text-underline-offset: 3px;
}
.library-anchor-links button:hover {
  color: var(--tp-text);
}
@media (max-width: 480px) {
  .library-definition {
    grid-template-columns: minmax(0, 1fr);
  }
  .library-definition dt {
    padding-bottom: 4px;
    border-bottom: 0;
  }
  .library-definition dd {
    padding-top: 4px;
  }
}
@media (prefers-reduced-motion: reduce) {
  .library-excerpt-toggle :deep(.is-open) {
    transform: none;
  }
}
:root[data-motion="reduced"] .library-excerpt-toggle :deep(.is-open) {
  transform: none;
}
</style>
