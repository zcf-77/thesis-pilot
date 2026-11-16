<script setup lang="ts">
import { nextTick, onMounted, ref } from "vue";
import { PhArrowRight } from "@phosphor-icons/vue";
import TpButton from "@/components/ui/TpButton.vue";
import TpField from "@/components/ui/TpField.vue";
import TpIcon from "@/components/ui/TpIcon.vue";

const props = defineProps<{ message: string; busy: boolean; notice?: boolean; submitLabel?: string }>();
const emit = defineEmits<{ unlock: [accessKey: string] }>();
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
  <form class="studio-stack" @submit.prevent="submit">
    <Transition name="tp-swap">
      <p v-if="message" :key="message" :role="notice ? 'status' : 'alert'" class="studio-notice">{{ message }}</p>
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
        data-autofocus
      />
    </TpField>
    <TpButton variant="primary" type="submit" :loading="busy" :disabled="busy">
      {{ busy ? "正在解锁…" : (submitLabel ?? "解锁工作区") }}<TpIcon v-if="!busy" :icon="PhArrowRight" />
    </TpButton>
  </form>
</template>
