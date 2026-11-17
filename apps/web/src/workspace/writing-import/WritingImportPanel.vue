<script setup lang="ts">
import { computed, onMounted } from "vue";
import { PhFileDoc, PhX } from "@phosphor-icons/vue";
import TpButton from "@/components/ui/TpButton.vue";
import TpField from "@/components/ui/TpField.vue";
import TpIcon from "@/components/ui/TpIcon.vue";
import TpSelect from "@/components/ui/TpSelect.vue";
import TpStatus from "@/components/ui/TpStatus.vue";
import { jobStatus } from "@/domain/vocab";
import { listMotionHooks } from "@/design/motion";
import { panelMotionHooks } from "@/lab/components/integration/motion";
import type { BackendServices, ProjectRead } from "@/services";
import type { DocsSnapshot } from "../editor/docsSnapshot";
import type { PreviewHighlight } from "../editor";
import { materialSize } from "../materials/materialPresentation";
import { importFailure, isActiveImport, useWritingImport } from "./useWritingImport";

const props = defineProps<{
  services: BackendServices;
  project: ProjectRead;
  document: { id: string; version: number; snapshot: DocsSnapshot } | null;
  selection: { node: string; start: number; end: number; text: string } | null;
  eligible: boolean;
}>();
const emit = defineEmits<{
  overlays: [group: string, highlights: PreviewHighlight[]];
  focus: [anchor: { node: string; start?: number; end?: number }];
  changed: [];
  close: [];
}>();

const flow = useWritingImport(props.services, props.project.id);
const { file, fileError, originals, originalChoice, job, preview, receipt, busy, error, ready } = flow;

const BLOCK_LABEL: Record<string, string> = { paragraph: "段落", heading: "标题", table: "表格", image: "图片", list: "列表", quote: "引用" };
const originalOptions = computed(() => [
  { value: "", label: originals.value.length ? "不使用已上传原件" : "资料中没有 Word 原件" },
  ...originals.value.map((item) => ({ value: item.value, label: item.label })),
]);
const status = computed(() => {
  const current = job.value;
  if (!current) return undefined;
  const word = jobStatus[current.status === "succeeded" ? "done" : current.status];
  return { label: current.status === "running" ? "转换中" : word.label, tone: word.tone, live: word.live };
});
const protectedLosses = computed(() => preview.value?.losses.filter((item) => item.action === "protected") ?? []);
const notedLosses = computed(() => preview.value?.losses.filter((item) => item.action === "noted") ?? []);
const mode = computed(() => (props.document ? "new_version" : "create"));
/** Why the decision button is unavailable; null when it can be pressed. */
const blocked = computed(() => {
  const view = preview.value;
  if (!view) return null;
  if (mode.value === "create") return view.can_create ? null : "项目已有正式稿，请在写作页读取后作为新版本导入。";
  if (!props.eligible) return "正文有未保存的修改或不在最新版本。请先保存或回到最新版本，再作为新版本导入。";
  return view.can_append ? null : (view.append_blocked_reason ?? "当前正文不能作为新版本导入。");
});
const confirmLabel = computed(() => (mode.value === "create" ? "导入为正式稿" : `作为新版本导入（v${props.document!.version + 1}）`));

function onFile(event: Event) {
  const element = event.target as HTMLInputElement;
  flow.pickFile(element.files?.[0]);
  element.value = "";
}
async function decide() {
  const result = await flow.confirm(props.document ? { id: props.document.id, version: props.document.version } : null);
  if (result) emit("changed");
}
onMounted(() => {
  void flow.resume();
  void flow.loadOriginals();
});
</script>

<template>
  <section class="writing-import" aria-labelledby="writing-import-title" @keydown.esc.self="emit('close')">
    <header class="writing-import__head">
      <h2 id="writing-import-title" class="tp-subheading">导入 Word</h2>
      <TpButton variant="ghost" size="sm" icon-only label="关闭导入" @click="emit('close')"><TpIcon :icon="PhX" :size="16" /></TpButton>
    </header>

    <Transition name="tp-swap" mode="out-in" v-bind="panelMotionHooks">
      <form v-if="!job" key="pick" class="writing-import__stack" @submit.prevent="flow.start()">
        <TpField v-slot="field" label="Word 原件" :error="fileError">
          <label class="tp-file-control" :for="field.id">
            <span class="tp-file-control__button"><TpIcon :icon="PhFileDoc" :size="16" />选择 .docx</span>
            <span class="tp-file-control__text">{{ file ? `${file.name} · ${materialSize(file.size)}` : "上传后同时保留在资料中" }}</span>
            <input
              :id="field.id"
              type="file"
              class="tp-file-control__input"
              accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
              aria-label="选择 Word 原件"
              :aria-invalid="field.invalid"
              :aria-describedby="field.describedby"
              :disabled="!!busy && busy !== 'originals'"
              @change="onFile"
            />
          </label>
        </TpField>
        <TpField v-slot="{ id }" label="或使用资料中的原件">
          <TpSelect
            :id="id"
            :model-value="originalChoice"
            :options="originalOptions"
            :disabled="busy === 'originals' || busy === 'upload' || busy === 'start' || !originals.length"
            searchable
            @update:model-value="flow.chooseOriginal(String($event))"
          />
        </TpField>
        <Transition name="tp-swap" v-bind="panelMotionHooks">
          <p v-if="error" :key="error" class="studio-notice" role="alert">{{ error }}</p>
        </Transition>
        <div class="screen-actions">
          <TpButton type="submit" variant="primary" :loading="busy === 'upload' || busy === 'start'" :disabled="!ready || (!!busy && busy !== 'originals')"
            >生成导入预览</TpButton
          >
        </div>
      </form>

      <div v-else :key="job.job_id" class="writing-import__stack">
        <div class="writing-import__job">
          <div class="min-w-0">
            <p class="writing-import__file">
              {{ preview?.filename ?? originals.find((item) => item.originalId === job!.original_id)?.filename ?? "Word 原件" }}
            </p>
            <p v-if="job.source_job_id" class="tp-caption">按原输入重试</p>
          </div>
          <Transition name="tp-swap" mode="out-in" v-bind="panelMotionHooks">
            <TpStatus v-if="status" :key="job.status" v-bind="status" size="sm" />
          </Transition>
        </div>

        <Transition name="tp-swap" mode="out-in" v-bind="panelMotionHooks">
          <div v-if="isActiveImport(job)" key="active" class="screen-actions">
            <TpButton size="sm" variant="ghost" :loading="busy === 'cancel'" :disabled="!!busy" @click="flow.cancel()">取消导入</TpButton>
          </div>

          <div
            v-else-if="job.status !== 'succeeded'"
            key="failed"
            class="writing-import__failure"
            :data-status="job.status"
            :role="job.status === 'failed' ? 'alert' : undefined"
          >
            <p>{{ importFailure(job) }}</p>
            <div class="screen-actions">
              <TpButton size="sm" :loading="busy === 'retry'" :disabled="!!busy" @click="flow.retry()">按原输入重试</TpButton
              ><TpButton size="sm" variant="ghost" :disabled="!!busy" @click="flow.reset()">重新选择文件</TpButton>
            </div>
          </div>

          <div v-else-if="receipt" key="done" class="writing-import__stack">
            <p class="writing-import__result">正文 v{{ receipt.document_version }} 已由 {{ preview?.filename ?? "Word 原件" }} 导入。</p>
            <div class="screen-actions">
              <TpButton size="sm" variant="ghost" @click="flow.reset()">导入其他文件</TpButton>
            </div>
          </div>

          <div v-else-if="preview" key="preview" class="writing-import__stack">
            <dl class="writing-import__counts" aria-label="导入概况">
              <div>
                <dt>章节</dt>
                <dd>{{ preview.chapters.length }}{{ preview.chapters_truncated ? "+" : "" }}</dd>
              </div>
              <div>
                <dt>段落</dt>
                <dd>{{ preview.paragraph_count }}</dd>
              </div>
              <div>
                <dt>表格</dt>
                <dd>{{ preview.table_count }}</dd>
              </div>
              <div>
                <dt>图片</dt>
                <dd>{{ preview.image_count }}</dd>
              </div>
              <div>
                <dt>字符</dt>
                <dd>{{ preview.text_characters }}</dd>
              </div>
            </dl>

            <section v-if="preview.chapters.length" class="writing-import__section" aria-labelledby="writing-import-chapters">
              <h3 id="writing-import-chapters" class="tp-label">章节</h3>
              <TransitionGroup tag="ol" name="tp-list" class="writing-import__chapters tp-list-group" v-bind="listMotionHooks">
                <li v-for="chapter in preview.chapters" :key="chapter.id" :style="{ '--level': Math.min(chapter.level, 4) - 1 }">
                  {{ chapter.title || "（无标题）" }}
                </li>
              </TransitionGroup>
              <p v-if="preview.chapters_truncated" class="tp-caption">只列出前 {{ preview.chapters.length }} 个章节。</p>
            </section>

            <section v-if="preview.objects.length" class="writing-import__section" aria-labelledby="writing-import-objects">
              <h3 id="writing-import-objects" class="tp-label">受保护对象 · {{ preview.objects.length }}</h3>
              <ul class="writing-import__objects">
                <li v-for="item in preview.objects" :key="item.node_id">
                  <span class="writing-import__kind">{{ BLOCK_LABEL[item.block_type] ?? item.block_type }}</span
                  ><span class="writing-import__excerpt">{{ item.excerpt || "（无文字）" }}</span>
                </li>
              </ul>
            </section>

            <section v-if="preview.losses.length" class="writing-import__section" aria-labelledby="writing-import-losses">
              <h3 id="writing-import-losses" class="tp-label">损失报告</h3>
              <div v-if="protectedLosses.length" class="writing-import__loss-group">
                <p class="writing-import__loss-title">已保护 · 原件保留，导入后不可编辑</p>
                <ul>
                  <li v-for="(item, index) in protectedLosses" :key="`p${index}`">
                    {{ item.label }}<span v-if="item.detail" class="tp-caption"> · {{ item.detail }}</span>
                  </li>
                </ul>
              </div>
              <div v-if="notedLosses.length" class="writing-import__loss-group" data-action="noted">
                <p class="writing-import__loss-title">已记录 · 导入后不再保留</p>
                <ul>
                  <li v-for="(item, index) in notedLosses" :key="`n${index}`">
                    {{ item.label }}<span v-if="item.detail" class="tp-caption"> · {{ item.detail }}</span>
                  </li>
                </ul>
              </div>
            </section>

            <Transition name="tp-swap" mode="out-in" v-bind="panelMotionHooks">
              <p v-if="error" :key="error" class="studio-notice" role="alert">{{ error }}</p>
              <p v-else-if="blocked" :key="blocked" class="studio-notice">{{ blocked }}</p>
            </Transition>
            <div class="screen-actions">
              <TpButton variant="primary" :loading="busy === 'confirm'" :disabled="!!busy || !!blocked" @click="decide">{{ confirmLabel }}</TpButton
              ><TpButton variant="ghost" :disabled="!!busy" @click="flow.reset()">重新选择文件</TpButton>
            </div>
          </div>
        </Transition>
        <Transition name="tp-swap" v-bind="panelMotionHooks">
          <p v-if="error && job.status !== 'succeeded'" :key="error" class="studio-notice" role="alert">{{ error }}</p>
        </Transition>
      </div>
    </Transition>
  </section>
</template>

<style scoped>
.writing-import {
  display: flex;
  flex-direction: column;
  gap: 16px;
  min-width: 0;
}
.writing-import__head,
.writing-import__job {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}
.writing-import__stack {
  display: flex;
  flex-direction: column;
  gap: 16px;
  min-width: 0;
}
.writing-import__file {
  font-weight: 600;
  overflow-wrap: anywhere;
}
.writing-import__failure {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 12px 16px;
  border-left: 3px solid var(--tp-danger);
  border-radius: var(--tp-radius-s);
  background: var(--tp-surface-sunken);
  font-size: 13px;
  line-height: 1.7;
}
.writing-import__failure[data-status="cancelled"] {
  border-left: 3px dashed var(--tp-line-strong);
}
.writing-import__result {
  font-size: 14px;
  line-height: 1.7;
}
.writing-import__counts {
  display: grid;
  grid-template-columns: repeat(5, minmax(0, 1fr));
  gap: 8px;
  margin: 0;
  padding: 12px;
  border: 1px solid var(--tp-line);
  border-radius: var(--tp-radius-s);
  background: var(--tp-surface-sunken);
}
.writing-import__counts dt {
  font-size: 11px;
  color: var(--tp-text-muted);
}
.writing-import__counts dd {
  margin: 2px 0 0;
  font-family: var(--tp-font-mono);
  font-size: 15px;
  font-variant-numeric: tabular-nums;
}
.writing-import__section {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.writing-import__chapters,
.writing-import__objects,
.writing-import__loss-group ul {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin: 0;
  padding: 0;
  list-style: none;
  font-size: 13px;
  line-height: 1.6;
}
.writing-import__chapters {
  max-height: 240px;
  overflow-y: auto;
}
.writing-import__chapters li {
  padding-left: calc(var(--level, 0) * 14px);
  overflow-wrap: anywhere;
}
.writing-import__objects li {
  display: flex;
  gap: 8px;
  min-width: 0;
}
.writing-import__kind {
  flex: none;
  padding: 0 6px;
  border: 1px dashed var(--tp-line-strong);
  border-radius: var(--tp-radius-s);
  font-size: 11px;
  line-height: 1.8;
  color: var(--tp-text-muted);
}
.writing-import__excerpt {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.writing-import__loss-group {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 10px 12px;
  border-left: 3px solid var(--tp-line-strong);
  border-radius: var(--tp-radius-s);
  background: var(--tp-surface-sunken);
}
.writing-import__loss-group[data-action="noted"] {
  border-left-style: dashed;
}
.writing-import__loss-title {
  font-size: 12px;
  font-weight: 600;
}
.writing-import__loss-group li {
  overflow-wrap: anywhere;
}
@media (max-width: 420px) {
  .writing-import__counts {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }
}
</style>
