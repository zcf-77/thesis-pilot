<script setup lang="ts">
import { marked } from "marked";
import { computed } from "vue";
import spec from "../../../docs/design/DESIGN-SPEC.md?raw";
import LabPage from "../LabPage.vue";

/** 规范文档：直接渲染 docs/design/DESIGN-SPEC.md（同一份文件，不维护第二份）。 */
const body = spec.replace(/^# .*\n/, "");
const html = computed(() => marked.parse(body, { async: false, gfm: true }));
const toc = computed(() => [...body.matchAll(/^## (.+)$/gm)].map((m) => ({ title: m[1], id: "s-" + m[1].split(".")[0].trim() })));
const withIds = computed(() => {
  let i = 0;
  return html.value.replace(/<h2>/g, () => '<h2 id="' + (toc.value[i++]?.id ?? "") + '">');
});
function jump(id: string) {
  document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
}
</script>

<template>
  <LabPage
    no="08"
    eyebrow="Specification"
    title="设计规范文档"
    lead="正式的规范文本，与仓库中的 docs/design/DESIGN-SPEC.md 是同一份文件。前面几页是它的可交互版本；需要逐条核对或转给他人时看这一页。"
  >
    <div class="lab-spec-layout">
      <nav class="lab-spec-toc" aria-label="规范目录">
        <p class="tp-label mb-2">目录</p>
        <button v-for="item in toc" :key="item.id" type="button" @click="jump(item.id)">{{ item.title }}</button>
      </nav>
      <!-- 内容来自仓库内的规范文档，非用户输入 -->
      <div class="lab-md tp-card" v-html="withIds" />
    </div>
  </LabPage>
</template>
