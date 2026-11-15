<script setup lang="ts">
import { computed, nextTick, ref, useId, watch } from "vue";
import TpButton from "@/components/ui/TpButton.vue";
import type { BackendServices } from "@/services";
import { listMotionHooks } from "@/design/motion";

const props = defineProps<{ parsed: Awaited<ReturnType<BackendServices["materials"]["parse"]>> }>();
const result = computed(() => props.parsed.result);
const shown = ref(20);
const focused = ref("");
const anchorPrefix = useId();
const stateLabel = { recognized: "已识别", unknown: "未知", conflict: "冲突" };
const scopeLabel = (value: string) => ({ body: "正文", document: "全文", references: "参考文献", title: "标题" } as Record<string, string>)[value] ?? value;
const fieldLabel = (value: string) =>
  (
    { font_family: "字体", font_size: "字号", line_spacing: "行距", page_size: "纸张", body_font: "正文字体", body_font_size: "正文字号" } as Record<
      string,
      string
    >
  )[value] ?? value;
async function focusAnchor(id: string) {
  const index = result.value.anchors.findIndex((item) => item.id === id);
  if (index < 0) return;
  shown.value = Math.max(shown.value, index + 1);
  focused.value = id;
  await nextTick();
  document.getElementById(`${anchorPrefix}-${index}`)?.scrollIntoView({ block: "nearest" });
}
watch(
  () => props.parsed.id,
  () => {
    shown.value = 20;
    focused.value = "";
  },
);
</script>

<template>
  <section class="studio-stack material-parse-result" aria-label="解析结果">
    <div class="studio-row">
      <h3 class="tp-heading">解析结果 · v{{ parsed.version }}</h3>
      <span class="tp-caption">{{ result.status === "complete" ? "解析完成" : "部分解析" }}</span>
    </div>
    <p class="tp-caption">{{ result.parser_version }} · {{ result.anchors.length }} 个来源锚点 · {{ result.editor_json ? "已保留编辑投影" : "无编辑投影" }}</p>
    <section v-if="result.diagnostics.length" class="studio-stack" aria-label="解析诊断">
      <h4 class="tp-heading">解析诊断</h4>
      <ul class="material-diagnostics">
        <li v-for="(diagnostic, index) in result.diagnostics" :key="index">{{ diagnostic }}</li>
      </ul>
    </section>
    <section class="studio-stack" aria-label="提取文本">
      <h4 class="tp-heading">提取文本</h4>
      <div class="material-readable-text">{{ result.plain_text || "本解析版本没有可读文本；请结合诊断检查原件。" }}</div>
    </section>
    <section class="studio-stack" aria-label="模板字段">
      <h4 class="tp-heading">模板字段</h4>
      <p v-if="!result.template_items.length" class="tp-caption">未提取到可核验的模板字段，不补造格式值。</p>
      <article v-for="item in result.template_items" :key="item.id" class="material-extract-card">
        <div class="studio-row">
          <strong>{{ fieldLabel(item.field) }} · {{ scopeLabel(item.scope) }}</strong><span class="tp-caption">{{ stateLabel[item.state] }}</span>
        </div>
        <p>{{ item.value === null ? "未识别" : String(item.value) }}<span v-if="item.unit"> {{ item.unit }}</span></p>
        <p v-if="item.note" class="tp-caption">{{ item.note }}</p>
        <div class="screen-actions">
          <TpButton v-for="(id, index) in item.anchor_ids" :key="id" size="sm" variant="ghost" @click="focusAnchor(id)">查看模板来源 {{ index + 1 }}</TpButton>
        </div>
      </article>
    </section>
    <section class="studio-stack" aria-label="提取要求">
      <h4 class="tp-heading">提取要求</h4>
      <p v-if="!result.requirements.length" class="tp-caption">未提取到要求；保留原文供核对，不视为没有要求。</p>
      <article v-for="item in result.requirements" :key="item.id" class="material-extract-card">
        <blockquote>{{ item.original_text }}</blockquote>
        <p class="tp-caption">
          {{ scopeLabel(item.scope) }} · {{ item.rule_type === "hard" ? "程序规则" : "语义建议" }} · {{ item.checkable ? "可程序核对" : "暂不可程序判定" }} ·
          {{ item.strictness === "required" ? "必需" : item.strictness === "suggested" ? "建议" : "约束未知" }}
        </p>
        <p v-if="Object.keys(item.parameters ?? {}).length" class="tp-caption">
          判定参数：<span v-for="(value, key) in item.parameters" :key="key">{{ key }} = {{ value }} </span>
        </p>
        <p v-if="item.uncertainty" class="studio-notice">{{ item.uncertainty }}</p>
        <div class="screen-actions">
          <TpButton v-for="(id, index) in item.anchor_ids" :key="id" size="sm" variant="ghost" @click="focusAnchor(id)">查看要求来源 {{ index + 1 }}</TpButton>
        </div>
      </article>
    </section>
    <section class="studio-stack" aria-label="来源锚点">
      <h4 class="tp-heading">来源锚点</h4>
      <p v-if="!result.anchors.length" class="tp-caption">本版本没有可定位的来源锚点。</p>
      <TransitionGroup name="tp-list" tag="div" class="studio-stack tp-list-group" v-bind="listMotionHooks"
        ><article
          v-for="(anchor, index) in result.anchors.slice(0, shown)"
          :id="`${anchorPrefix}-${index}`"
          :key="anchor.id"
          class="material-source-anchor"
          :class="{ 'is-focused': focused === anchor.id }"
        >
          <p class="tp-caption">
            {{ anchor.part }}<span v-if="anchor.line"> · 第 {{ anchor.line }} 行</span><span v-if="anchor.xml_path"> · {{ anchor.xml_path }}</span> ·
            {{ anchor.editable ? "可编辑映射" : "受保护或只读来源" }}
          </p>
          <blockquote>{{ anchor.original_text }}</blockquote>
        </article></TransitionGroup
      ><TpButton v-if="shown < result.anchors.length" size="sm" @click="shown += 20">查看更多来源（{{ shown }}/{{ result.anchors.length }}）</TpButton>
    </section>
  </section>
</template>

<style scoped>
.material-parse-result {
  padding-top: 18px;
  border-top: 1px solid var(--tp-line);
}
.material-readable-text {
  padding: 18px;
  max-height: 420px;
  overflow: auto;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  line-height: 1.8;
  font-size: 14px;
  background: var(--tp-surface-sunken);
  border-radius: var(--tp-radius-s);
}
.material-extract-card,
.material-source-anchor {
  padding: 14px;
  border: 1px solid var(--tp-line);
  border-radius: var(--tp-radius-s);
  overflow-wrap: anywhere;
  scroll-margin-top: 80px;
}
.material-source-anchor.is-focused {
  border-color: var(--tp-focus);
  box-shadow: 0 0 0 1px var(--tp-focus);
}
blockquote {
  margin: 10px 0;
  white-space: pre-wrap;
  font-size: 14px;
  line-height: 1.7;
}
.material-diagnostics {
  padding-left: 20px;
  font-size: 13px;
  color: var(--tp-text-muted);
}
</style>
