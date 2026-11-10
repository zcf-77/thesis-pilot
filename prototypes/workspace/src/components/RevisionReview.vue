<script setup lang="ts">
import { Check, WandSparkles } from "@lucide/vue";
import type { RevisionCandidate } from "../types";

defineProps<{ candidate: RevisionCandidate; stale: boolean; error: string }>();
const emit = defineEmits<{ accept: []; reject: [] }>();
</script>

<template>
  <section class="revision-review" aria-label="修订审阅">
    <header class="review-heading">
      <WandSparkles :size="15" aria-hidden="true" />
      <h3>修订建议</h3>
      <span class="example-tag">原型示例</span>
    </header>
    <div class="revision-text original">
      <span class="text-label">原文</span>
      <p><del>{{ candidate.original }}</del></p>
    </div>
    <div class="revision-text proposed">
      <span class="text-label">建议</span>
      <p><ins>{{ candidate.proposed }}</ins></p>
    </div>
    <p class="reason">{{ candidate.reason }}</p>
    <p v-if="candidate.status === 'pending' && stale" class="notice" role="status">
      正文已变化，请重新选择后生成
    </p>
    <p v-if="error" class="notice error" role="alert">{{ error }}</p>
    <div v-if="candidate.status === 'pending'" class="revision-actions">
      <button
        class="btn btn-sm accept-button"
        type="button"
        :disabled="stale || Boolean(error)"
        @click="emit('accept')"
      >
        <Check :size="14" aria-hidden="true" />采纳修改
      </button>
      <button class="btn btn-sm btn-ghost keep-button" type="button" @click="emit('reject')">
        保留原文
      </button>
    </div>
    <p v-else class="resolved" role="status">
      <Check :size="14" aria-hidden="true" />{{
        candidate.status === "accepted" ? "已采纳修改" : "已保留原文"
      }}
    </p>
  </section>
</template>

<style scoped>
.revision-review {
  min-width: 0;
  padding: 18px;
}
.review-heading {
  display: flex;
  align-items: center;
  gap: 7px;
  color: var(--accent);
  margin-bottom: 15px;
}
h3 {
  margin: 0;
  color: var(--ink);
  font-size: 12px;
  font-weight: 600;
}
.example-tag {
  margin-left: auto;
  color: var(--muted);
  font-size: 10px;
}
.revision-text {
  display: grid;
  grid-template-columns: 28px minmax(0, 1fr);
  gap: 9px;
  padding: 10px;
  font-size: 11px;
  line-height: 1.9;
  border-radius: 5px;
}
.text-label {
  padding-top: 1px;
  color: var(--muted);
  font-size: 10px;
}
.revision-text p {
  margin: 0;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
.original {
  background: #f8f5f2;
  color: #7f7269;
}
.proposed {
  margin-top: 5px;
  background: var(--soft);
  color: var(--accent);
}
del {
  text-decoration-color: #bcaaa0;
}
ins {
  text-decoration: none;
}
.reason {
  margin: 12px 0 0;
  color: var(--muted);
  font-size: 11px;
  line-height: 1.8;
}
.notice {
  margin: 12px 0 0;
  color: #996526;
  font-size: 11px;
  line-height: 1.8;
}
.error {
  color: #ac5345;
}
.revision-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 7px;
  margin-top: 15px;
}
.revision-actions .btn {
  height: 30px;
  min-height: 30px;
  border-radius: 6px;
  font-size: 11px;
  font-weight: 500;
  box-shadow: none;
}
.accept-button {
  padding: 0 11px;
  border: 0;
  background: var(--accent);
  color: white;
}
.accept-button:disabled {
  background: var(--soft);
  color: #a7b3aa;
}
.keep-button {
  color: var(--muted);
}
.resolved {
  display: flex;
  align-items: center;
  gap: 5px;
  margin: 14px 0 0;
  color: var(--accent);
  font-size: 11px;
}
button:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 3px;
}
</style>
