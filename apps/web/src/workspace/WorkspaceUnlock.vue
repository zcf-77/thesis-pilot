<script setup lang="ts">
import LabLogo from "@/lab/LabLogo.vue";
import TpState from "@/components/ui/TpState.vue";
import WorkspaceUnlockForm from "./shell/WorkspaceUnlockForm.vue";

defineProps<{ state: "checking" | "locked" | "failed"; message: string; busy: boolean }>();
defineEmits<{ unlock: [accessKey: string]; retry: [] }>();
</script>

<template>
  <main class="workspace-gate" aria-labelledby="workspace-title">
    <Transition appear name="tp-page">
      <section class="workspace-gate__panel screen-panel studio-body studio-stack">
        <div class="workspace-brand"><LabLogo :size="32" /><span>ThesisPilot</span></div>
        <h1 id="workspace-title" class="tp-title">论文工作区</h1>
        <div v-if="state === 'checking'" class="workspace-loading" role="status" aria-busy="true">
          <span class="tp-btn__spinner" aria-hidden="true" />正在检查会话…
        </div>
        <TpState v-else-if="state === 'failed'" kind="error" title="无法检查会话" :desc="message" retryable @retry="$emit('retry')" />
        <WorkspaceUnlockForm v-else :message="message" :busy="busy" :notice="message === '已退出工作区。'" @unlock="$emit('unlock', $event)" />
      </section>
    </Transition>
  </main>
</template>
