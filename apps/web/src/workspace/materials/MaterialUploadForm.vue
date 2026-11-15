<script setup lang="ts">
import { ref, shallowRef } from "vue";
import TpButton from "@/components/ui/TpButton.vue";
import TpField from "@/components/ui/TpField.vue";
import TpSelect from "@/components/ui/TpSelect.vue";
import { panelMotionHooks } from "@/lab/components/integration/motion";
import { materialCategories, materialFileError, materialFormat, materialSize } from "./materialPresentation";

const props = defineProps<{ busy: boolean; title?: string; initial?: { name: string; category: string; source: string } }>();
const emit = defineEmits<{ upload: [input: { file: File; name: string; category: string; source: string }]; close: [] }>();
const input = ref<HTMLInputElement>();
const file = shallowRef<File>();
const name = ref(props.initial?.name ?? "");
const category = ref(props.initial?.category ?? "other");
const source = ref(props.initial?.source ?? "");
const error = ref("");

function pick(event: Event) {
  const selected = (event.target as HTMLInputElement).files?.[0];
  if (!selected) return;
  error.value = materialFileError(selected);
  if (error.value) {
    file.value = undefined;
    if (input.value) input.value.value = "";
    return;
  }
  file.value = selected;
  if (!name.value.trim()) name.value = selected.name.replace(/\.[^.]+$/, "");
}

function submit() {
  if (props.busy) return;
  error.value = "";
  if (!file.value) {
    error.value = "请先选择资料文件。";
    return;
  }
  if (!name.value.trim() || Array.from(name.value.trim()).length > 200) {
    error.value = "请输入 1 至 200 个字符的资料名称。";
    return;
  }
  const fileError = materialFileError(file.value);
  if (fileError) {
    error.value = fileError;
    return;
  }
  emit("upload", { file: file.value, name: name.value.trim(), category: category.value, source: source.value.trim() });
}
</script>

<template>
  <section class="screen-panel studio-body studio-stack" aria-label="上传资料" @keydown.esc.stop="emit('close')">
    <div class="studio-row">
      <h2 class="tp-heading">{{ title ?? "上传资料" }}</h2>
      <TpButton size="sm" variant="ghost" @click="emit('close')">关闭上传</TpButton>
    </div>
    <form class="studio-stack" @submit.prevent="submit">
      <label class="tp-file-control">
        <span class="tp-file-control__button">选择资料文件</span>
        <span class="tp-file-control__text">{{ file?.name ?? "DOCX、UTF-8 文本或 PDF，最多 8 MiB。" }}</span>
        <input
          ref="input"
          type="file"
          class="tp-file-control__input"
          accept=".docx,.txt,.text,.md,.pdf,text/plain,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
          aria-label="资料文件"
          :disabled="busy"
          @change="pick"
        />
      </label>
      <p v-if="file" role="status" class="tp-caption">已选择：{{ file.name }} · {{ materialSize(file.size) }}</p>
      <p v-if="file && materialFormat(file) === 'pdf'" class="studio-notice">PDF 原件可保存；当前不支持 PDF 解析，自动解析任务将明确报告未支持。</p>
      <div class="material-upload-fields">
        <TpField v-slot="{ id }" label="资料名称" required
          ><input :id="id" v-model="name" class="tp-input" maxlength="200" :readonly="busy" required
        /></TpField>
        <TpField v-slot="{ id }" label="资料分类"><TpSelect :id="id" v-model="category" :options="materialCategories" :disabled="busy" /></TpField>
        <TpField v-slot="{ id }" label="资料来源" hint="例如课程公开要求、自制模板；不填写密钥或私人对话。" class="material-upload-source">
          <textarea :id="id" v-model="source" class="tp-input" rows="2" maxlength="4000" :readonly="busy" />
        </TpField>
      </div>
      <Transition name="tp-swap" v-bind="panelMotionHooks"><p v-if="error" :key="error" class="studio-notice" role="alert">{{ error }}</p></Transition>
      <p class="tp-caption">上传后自动创建解析任务，保留原件与来源；不会创建或覆盖正式论文。</p>
      <div class="screen-actions">
        <TpButton type="submit" variant="primary" :disabled="busy" :loading="busy">上传并解析</TpButton
        ><TpButton variant="ghost" @click="emit('close')">取消</TpButton>
      </div>
    </form>
  </section>
</template>

<style scoped>
.material-upload-fields {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 18px;
}
.material-upload-source {
  grid-column: 1/-1;
}
textarea {
  width: 100%;
  resize: vertical;
}
@media (max-width: 700px) {
  .material-upload-fields {
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>
