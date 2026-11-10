<script setup lang="ts">
import { PhArrowsClockwise, PhFileText, PhGitCommit, PhPaperclip } from "@phosphor-icons/vue";
import TpIcon from "@/components/ui/TpIcon.vue";
import type { EvidenceView } from "@/domain/types";

/** 证据标记：任务完成所依据的具体对象与版本。stale 表示证据已被替换或正文版本已变，需要复核。 */
defineProps<{ evidence: EvidenceView }>();
const icons = { document: PhFileText, file: PhPaperclip, revision: PhGitCommit };
</script>

<template>
  <span class="tp-evi" :class="{ 'is-stale': evidence.stale }">
    <TpIcon :icon="evidence.stale ? PhArrowsClockwise : icons[evidence.kind]" :size="12" />
    {{ evidence.label }}
    <b v-if="evidence.version !== undefined">v{{ evidence.version }}</b>
    <template v-if="evidence.stale">· 需复核</template>
  </span>
</template>
