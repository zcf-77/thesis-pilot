<script setup lang="ts">
import { nextTick, onMounted, ref } from "vue";
import { PhArrowRight } from "@phosphor-icons/vue";
import LabLogo from "@/lab/LabLogo.vue";
import TpButton from "@/components/ui/TpButton.vue";
import TpField from "@/components/ui/TpField.vue";
import TpIcon from "@/components/ui/TpIcon.vue";
import TpState from "@/components/ui/TpState.vue";

const props = defineProps<{ state: "checking" | "locked" | "failed"; message: string; busy: boolean }>();
const emit = defineEmits<{ unlock: [accessKey: string]; retry: [] }>();
const key = ref("");
const input = ref<HTMLInputElement>();

function submit() {
  if (!key.value || props.busy) return;
  emit("unlock", key.value);
  key.value = "";
  void nextTick(() => input.value?.focus());
}

onMounted(() => input.value?.focus());
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
        <form v-else class="studio-stack" @submit.prevent="submit">
          <Transition name="tp-swap">
            <p v-if="message" :key="message" :role="message === '已退出工作区。' ? 'status' : 'alert'" class="studio-notice">{{ message }}</p>
          </Transition>
          <TpField v-slot="{ id }" label="工作区访问口令">
            <input
              :id="id"
              ref="input"
              v-model="key"
              class="tp-input"
              type="password"
              autocomplete="off"
              maxlength="4096"
              required
              :readonly="busy"
              spellcheck="false"
            />
          </TpField>
          <TpButton variant="primary" type="submit" :loading="busy" :disabled="busy">
            {{ busy ? "正在解锁…" : "解锁工作区" }}<TpIcon v-if="!busy" :icon="PhArrowRight" />
          </TpButton>
        </form>
      </section>
    </Transition>
  </main>
</template>
