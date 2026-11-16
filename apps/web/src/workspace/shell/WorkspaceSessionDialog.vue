<script setup lang="ts">
import { computed } from "vue";
import TpDialog from "@/components/ui/TpDialog.vue";
import WorkspaceUnlockForm from "./WorkspaceUnlockForm.vue";

/** Session expiry pauses the mounted workspace; only a fresh unlock or a full exit ends the pause. */
const props = defineProps<{ open: boolean; message: string; busy: boolean }>();
defineEmits<{ unlock: [accessKey: string] }>();
const visible = computed({ get: () => props.open, set: () => {} });
</script>

<template>
  <TpDialog v-model:open="visible" title="会话已结束" description="当前页面和未保存内容仍保留，重新输入口令即可继续。">
    <WorkspaceUnlockForm v-if="open" :message="message" :busy="busy" submit-label="继续工作" @unlock="$emit('unlock', $event)" />
  </TpDialog>
</template>
