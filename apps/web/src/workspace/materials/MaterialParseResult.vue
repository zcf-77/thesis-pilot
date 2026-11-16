<script setup lang="ts">
import { computed, nextTick, ref, useId, watch } from "vue";
import { PhArrowDown, PhBookOpen } from "@phosphor-icons/vue";
import TpButton from "@/components/ui/TpButton.vue";
import TpIcon from "@/components/ui/TpIcon.vue";
import TpStatus from "@/components/ui/TpStatus.vue";
import type { BackendServices } from "@/services";
import { listMotionHooks } from "@/design/motion";
import { panelMotionHooks } from "@/lab/components/integration/motion";
import { highlightParts, materialFragments, matchesQuery } from "./materialPresentation";
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
const scopeLabel = (value: string) => ({ body: "正文", document: "全文", references: "参考文献", title: "标题" } as Record<string, string>)[value] ?? value;
const fieldLabel = (value: string) =>
  (
    { font_family: "字体", font_size: "字号", line_spacing: "行距", page_size: "纸张", body_font: "正文字体", body_font_size: "正文字号" } as Record<
      string,
      string
    >
  )[value] ?? value;

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
    ? `已恢复原模板绑定，当前绑定 v${latest.version}。`
    : target
      ? `此模板版本已绑定为项目模板（绑定 v${latest.version}）。`
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
    <p v-if="result.diagnostics.length" class="tp-ghost library-detail-note" role="status">
      <span>{{ result.status === "partial" ? "部分内容未能识别：" : "解析说明：" }}{{ result.diagnostics.join("；") }}</span>
    </p>
    <button type="button" class="library-excerpt-toggle" :aria-expanded="open" :aria-controls="`${prefix}-excerpt`" @click="open = !open">
      <span><TpIcon :icon="PhBookOpen" :size="16" />提取结果与定位</span><TpIcon :icon="PhArrowDown" :size="14" :class="{ 'is-open': open }" />
    </button>
    <Transition name="tp-swap" v-bind="panelMotionHooks"
      ><section v-show="open" :id="`${prefix}-excerpt`" class="library-excerpt" aria-label="解析结果">
        <p class="tp-label">解析 v{{ parsed.version }} · {{ result.status === "complete" ? "解析完成" : "部分识别" }} · {{ fragments.length }} 段</p>
        <p v-if="!fragments.length" class="tp-caption mt-2">本解析版本没有可读文本；可下载原件核对。</p>
        <p v-else-if="!visible.length" class="tp-caption mt-2">没有包含“{{ query }}”的片段。</p>
        <TransitionGroup name="tp-list" tag="div" class="library-fragments tp-list-group" v-bind="listMotionHooks"
          ><article
            v-for="fragment in visible.slice(0, shown)"
            :id="`${prefix}-${fragment.id}`"
            :key="fragment.id"
            class="library-fragment"
            :class="{ 'is-focused': focused === fragment.id }"
          >
            <span class="tp-label">{{ fragment.label }}<template v-if="!fragment.editable"> · 受保护对象</template></span>
            <blockquote>
              <template v-for="(part, index) in highlightParts(fragment.text, query)" :key="index"
                ><mark v-if="part.match">{{ part.text }}</mark><template v-else>{{ part.text }}</template></template
              >
            </blockquote>
          </article></TransitionGroup
        >
        <TpButton v-if="shown < visible.length" size="sm" @click="shown += 20">查看更多片段（{{ shown }}/{{ visible.length }}）</TpButton>
      </section></Transition
    >

    <section v-if="kind === 'template'" :id="`${prefix}-template`" class="library-template" aria-label="模板结构与支持范围">
      <h3 class="tp-subheading">模板结构与支持范围</h3>
      <dl v-if="result.template_items.length" class="library-definition">
        <template v-for="item in result.template_items" :key="item.id"
          ><dt>{{ fieldLabel(item.field) }}<small>{{ scopeLabel(item.scope) }}</small></dt>
          <dd>
            <b>{{ item.value === null ? "未识别" : String(item.value) }}<template v-if="item.unit"> {{ item.unit }}</template></b>
            <TpStatus :tone="stateTone[item.state]" :label="stateLabel[item.state]" size="sm" />
            <small v-if="item.note">{{ item.note }}</small>
            <span v-if="item.anchor_ids.length" class="library-anchor-links"
              ><button v-for="(id, index) in item.anchor_ids" :key="id" type="button" @click="focusAnchor(id)">来源 {{ index + 1 }}</button></span
            >
          </dd></template
        >
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
        ><TpButton v-else size="sm" variant="ghost" :disabled="binding.busy.value || binding.mustReload.value" @click="bindTemplate(null)"
          >解除模板绑定</TpButton
        ><TpButton v-if="undoTemplate !== undefined" size="sm" variant="ghost" :disabled="binding.busy.value" @click="bindTemplate(undoTemplate, true)"
          >撤销模板绑定</TpButton
        ><TpButton v-if="binding.mustReload.value" size="sm" @click="binding.load()">载入最新绑定</TpButton>
      </div>
      <p v-if="templateBound" class="tp-caption">当前项目模板 · 绑定 v{{ binding.binding.value?.version }}</p>
      <p v-else-if="!available" class="tp-caption">资料已解绑或移出目录，恢复关联后才能绑定。</p>
      <Transition name="tp-swap" v-bind="panelMotionHooks"><p v-if="notice" :key="notice" role="status" class="tp-caption">{{ notice }}</p></Transition>
      <p class="tp-caption">绑定模板不会修改正文；新上传或重新解析不会自动替换已绑定版本。</p>
    </section>

    <section v-if="kind === 'requirements'" :id="`${prefix}-requirements`" class="library-template" aria-label="提取要求">
      <div class="library-detail-status">
        <h3 class="tp-subheading">提取要求</h3>
        <TpStatus :tone="requirementBound ? 'success' : 'neutral'" :label="requirementBound ? '已在要求集' : '未绑定'" size="sm" />
      </div>
      <p v-if="!result.requirements.length" class="tp-ghost library-detail-note">未提取到要求；原文保留供核对，不代表没有要求。</p>
      <TransitionGroup name="tp-list" tag="div" class="library-fragments tp-list-group" v-bind="listMotionHooks"
        ><article v-for="item in result.requirements" :key="item.id" class="library-requirement">
          <blockquote>{{ item.original_text }}</blockquote>
          <p class="tp-caption">
            {{ scopeLabel(item.scope) }} · {{ item.rule_type === "hard" ? "程序规则" : "语义建议" }} · {{ item.checkable ? "可程序核对" : "暂不可程序判定" }} ·
            {{ item.strictness === "required" ? "必需" : item.strictness === "suggested" ? "建议" : "约束未知" }}
          </p>
          <p v-if="Object.keys(item.parameters ?? {}).length" class="tp-caption">
            判定参数：<span v-for="(value, key) in item.parameters" :key="key">{{ key }} = {{ value }} </span>
          </p>
          <p v-if="item.uncertainty" class="tp-ghost library-detail-note">{{ item.uncertainty }}</p>
          <span v-if="item.anchor_ids.length" class="library-anchor-links"
            ><button v-for="(id, index) in item.anchor_ids" :key="id" type="button" @click="focusAnchor(id)">要求来源 {{ index + 1 }}</button></span
          >
        </article></TransitionGroup
      >
    </section>
  </div>
</template>

<style scoped>
.material-result {
  display: grid;
  gap: 20px;
  min-width: 0;
}
.library-detail-note {
  padding: 12px;
  font-size: 12px;
  line-height: 1.7;
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
  font-weight: 600;
  font-size: 12px;
  width: 100%;
  padding-top: 4px;
}
.library-excerpt-toggle > span {
  display: flex;
  align-items: center;
  gap: 8px;
}
.library-excerpt-toggle :deep(.is-open) {
  transform: rotate(180deg);
}
.library-excerpt {
  border-left: 2px solid var(--tp-line-strong);
  padding-left: 16px;
  min-width: 0;
}
.library-excerpt .tp-caption {
  font-size: 11px;
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
mark {
  background: var(--tp-pencil-soft, var(--tp-accent-soft));
  color: inherit;
  border-radius: 2px;
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
  grid-template-columns: 88px minmax(0, 1fr);
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
.library-anchor-links {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 12px;
  width: 100%;
}
.library-anchor-links button {
  font-size: 11px;
  color: var(--tp-text-muted);
  text-decoration: underline;
  text-underline-offset: 3px;
}
.library-anchor-links button:hover {
  color: var(--tp-text);
}
</style>
