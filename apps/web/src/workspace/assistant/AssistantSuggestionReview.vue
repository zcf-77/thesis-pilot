<script setup lang="ts">
import { computed, onScopeDispose, ref, shallowRef, watch } from "vue";
import { PhCheck, PhX } from "@phosphor-icons/vue";
import TpButton from "@/components/ui/TpButton.vue";
import TpIcon from "@/components/ui/TpIcon.vue";
import TpStatus from "@/components/ui/TpStatus.vue";
import DiffText from "@/components/domain/DiffText.vue";
import type { BackendServices, RevisionRead, RevisionDecision } from "@/services";
import { ApiError, asApiError } from "@/services/errors";
import { beginJobRequest, confirmJobRequest } from "@/lab/components/integration/jobsRequests";
import { listMotionHooks } from "@/design/motion";
import { panelMotionHooks } from "@/lab/components/integration/motion";
import { CHECK_LABELS, STATUS_VIEW } from "../writing-assistant/candidateReview";

/** 非写作副驾中的候选只保存逐项审阅决定，不提供正文写入入口。 */
const props = defineProps<{ services: BackendServices; projectId: string; documentId: string; candidateId: string; currentVersion: number }>();
const candidate = shallowRef<RevisionRead>();
const loading = ref(false);
const busy = ref(false);
const error = ref("");
const notice = ref("");
const mustReload = ref(false);
const uncertainCommand = ref(false);
const checksOpen = ref(false);
const decisions = ref<Record<string, RevisionDecision["decision"]>>({});
const stale = computed(() => !!candidate.value && candidate.value.base_version !== props.currentVersion);
const editable = computed(
  () =>
    !!candidate.value &&
    ["ready", "invalid"].includes(candidate.value.status) &&
    !stale.value &&
    !busy.value &&
    !loading.value &&
    !mustReload.value &&
    !uncertainCommand.value,
);
const failing = computed(() => candidate.value?.checks.filter((check) => check.result !== "pass") ?? []);
const passed = computed(() => candidate.value?.checks.filter((check) => check.result === "pass").length ?? 0);
let request: AbortController | undefined;
let identity = 0;
let command: { input: { command_id: string; expected_revision: number; decisions: RevisionDecision[] }; scope: string } | undefined;

async function load() {
  request?.abort();
  const controller = new AbortController();
  request = controller;
  const currentIdentity = identity;
  loading.value = true;
  error.value = "";
  try {
    const result = await props.services.revisions.get(props.projectId, props.documentId, props.candidateId, controller.signal);
    if (!controller.signal.aborted && currentIdentity === identity) {
      if (result.producer !== "model_run") throw new ApiError("INVALID_RESPONSE");
      candidate.value = result;
      decisions.value = Object.fromEntries(
        result.patches.map((patch) => [patch.id, result.decisions.find((item) => item.patch_id === patch.id)?.decision ?? "pending"]),
      );
      mustReload.value = false;
    }
  } catch (problem) {
    if (!controller.signal.aborted && currentIdentity === identity) error.value = asApiError(problem).message;
  } finally {
    if (!controller.signal.aborted && currentIdentity === identity) loading.value = false;
  }
}
function acceptanceBlocked(patchId: string) {
  return candidate.value?.checks.some((check) => check.result !== "pass" && (!check.patch_id || check.patch_id === patchId)) ?? true;
}
async function save() {
  if (!candidate.value || busy.value || mustReload.value) return;
  if (!command) {
    const values = candidate.value.patches.map((patch) => ({ patch_id: patch.id, decision: decisions.value[patch.id] ?? "pending" }));
    const scope =
      "thesispilot.pending-assistant-review:" +
      JSON.stringify([props.services.sourceKey, props.projectId, props.documentId, candidate.value.id, candidate.value.revision, values]);
    command = { scope, input: { command_id: beginJobRequest(scope), expected_revision: candidate.value.revision, decisions: values } };
  }
  const pending = command;
  const currentIdentity = identity;
  const controller = new AbortController();
  request = controller;
  busy.value = true;
  error.value = "";
  notice.value = "";
  try {
    await props.services.revisions.decide(props.projectId, props.documentId, props.candidateId, pending.input, controller.signal);
    if (controller.signal.aborted || currentIdentity !== identity) return;
    confirmJobRequest(pending.scope, pending.input.command_id);
    command = undefined;
    uncertainCommand.value = false;
    notice.value = "逐项决定已保存，正文未修改。";
    busy.value = false;
    await load();
  } catch (problem) {
    if (!controller.signal.aborted && currentIdentity === identity) {
      const issue = asApiError(problem);
      if (issue.status !== undefined && issue.status < 500 && issue.code !== "INVALID_RESPONSE") {
        confirmJobRequest(pending.scope, pending.input.command_id);
        command = undefined;
        mustReload.value = issue.status === 409;
      }
      error.value = command
        ? "保存结果未知，审阅选择已保留；请使用原命令确认。"
        : mustReload.value
          ? `${issue.message} 选择已保留，请载入最新候选后重新审阅。`
          : issue.message;
      uncertainCommand.value = !!command;
    }
  } finally {
    if (!controller.signal.aborted && currentIdentity === identity) busy.value = false;
  }
}
watch(
  () => [props.projectId, props.documentId, props.candidateId],
  () => {
    identity++;
    command = undefined;
    uncertainCommand.value = false;
    candidate.value = undefined;
    busy.value = false;
    notice.value = "";
    checksOpen.value = false;
    void load();
  },
  { immediate: true },
);
onScopeDispose(() => {
  identity++;
  request?.abort();
});
</script>

<template>
  <section class="assistant-review" aria-label="助手候选审阅" :aria-busy="loading || busy">
    <header class="assistant-review__head">
      <h3 class="tp-subheading">候选审阅</h3>
      <TpStatus
        v-if="candidate"
        size="sm"
        :tone="stale && ['ready', 'invalid'].includes(candidate.status) ? 'stale' : STATUS_VIEW[candidate.status].tone"
        :label="stale && ['ready', 'invalid'].includes(candidate.status) ? '已过期' : STATUS_VIEW[candidate.status].label"
      />
    </header>
    <p v-if="loading && !candidate" role="status" class="tp-caption">正在读取候选…</p>
    <p v-if="stale" role="status" class="assistant-review__state">
      候选基于正文 v{{ candidate?.base_version }}，当前为 v{{ currentVersion }}；请回到写作页重新生成。
    </p>
    <template v-if="candidate">
      <div class="assistant-review__goal">
        <span class="tp-label">修改目标</span>
        <p>{{ candidate.goal }}</p>
      </div>
      <div class="assistant-review__checks">
        <div>
          <span class="tp-caption">{{ failing.length ? `${failing.length} 项检查需要处理` : `${passed} 项程序检查通过` }}</span>
          <TpButton size="sm" variant="ghost" :aria-expanded="checksOpen" @click="checksOpen = !checksOpen">检查详情</TpButton>
        </div>
        <ul v-if="failing.length" class="assistant-review__failures">
          <li v-for="(check, index) in failing" :key="`${check.rule}:${index}`"><strong>{{ CHECK_LABELS[check.rule] }}</strong>{{ check.detail }}</li>
        </ul>
        <Transition name="tp-swap" v-bind="panelMotionHooks">
          <ul v-if="checksOpen" class="assistant-review__all-checks">
            <li v-for="(check, index) in candidate.checks" :key="`${check.rule}:${index}`">
              {{ CHECK_LABELS[check.rule] }} · {{ check.result === "pass" ? "通过" : check.result === "fail" ? "未通过" : "暂不支持" }}：{{ check.detail }}
            </li>
          </ul>
        </Transition>
      </div>
      <TransitionGroup tag="div" name="tp-list" v-bind="listMotionHooks" class="assistant-review__hunks tp-list-group">
        <article v-for="(patch, index) in candidate.patches" :key="patch.id" class="assistant-hunk" :data-decision="decisions[patch.id] ?? 'pending'">
          <div class="assistant-hunk__head">
            <span class="tp-label">片段 {{ index + 1 }}</span
            ><span class="tp-caption">{{ decisions[patch.id] === "accepted" ? "已接受" : decisions[patch.id] === "rejected" ? "已拒绝" : "待决定" }}</span>
          </div>
          <DiffText
            :segments="[
              { t: 'del', text: patch.before },
              { t: 'ins', text: patch.after },
            ]"
            :decision="decisions[patch.id] ?? 'pending'"
          />
          <div class="assistant-hunk__actions" role="group" :aria-label="`片段 ${index + 1} 的决定`">
            <TpButton
              size="sm"
              :variant="decisions[patch.id] === 'accepted' ? 'tonal' : 'ghost'"
              :aria-pressed="decisions[patch.id] === 'accepted'"
              :disabled="!editable || acceptanceBlocked(patch.id)"
              @click="decisions[patch.id] = 'accepted'"
              ><TpIcon :icon="PhCheck" :size="14" />接受</TpButton
            >
            <TpButton
              size="sm"
              :variant="decisions[patch.id] === 'rejected' ? 'tonal' : 'ghost'"
              :aria-pressed="decisions[patch.id] === 'rejected'"
              :disabled="!editable"
              @click="decisions[patch.id] = 'rejected'"
              ><TpIcon :icon="PhX" :size="14" />拒绝</TpButton
            >
            <TpButton v-if="decisions[patch.id] !== 'pending'" size="sm" variant="ghost" :disabled="!editable" @click="decisions[patch.id] = 'pending'"
              >改回待定</TpButton
            >
          </div>
        </article>
      </TransitionGroup>
      <div class="assistant-review__actions">
        <TpButton size="sm" variant="primary" :disabled="busy || loading || mustReload || (stale && !uncertainCommand)" :loading="busy" @click="save">{{
          uncertainCommand ? "使用原审阅命令确认" : "保存逐项决定"
        }}</TpButton>
        <TpButton v-if="mustReload" size="sm" variant="outline" @click="load">载入最新候选</TpButton>
        <TpButton v-else size="sm" variant="ghost" :disabled="busy || loading || uncertainCommand" @click="load">刷新候选</TpButton>
      </div>
      <p class="tp-caption">这里只保存审阅决定；采纳与撤销请在写作页完成。</p>
    </template>
    <Transition name="tp-swap" v-bind="panelMotionHooks"><p v-if="error" :key="error" role="alert" class="assistant-review__error">{{ error }}</p></Transition>
    <Transition name="tp-swap" v-bind="panelMotionHooks"
      ><p v-if="notice" :key="notice" role="status" class="assistant-review__notice">{{ notice }}</p></Transition
    >
  </section>
</template>

<style scoped>
.assistant-review {
  display: grid;
  gap: 12px;
  min-width: 0;
  padding-top: 14px;
  border-top: 1px solid var(--tp-pencil-line);
}
.assistant-review__head,
.assistant-review__checks > div,
.assistant-hunk__head,
.assistant-hunk__actions,
.assistant-review__actions {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
}
.assistant-review__head,
.assistant-review__checks > div,
.assistant-hunk__head {
  justify-content: space-between;
}
.assistant-review__head h3,
.assistant-review__goal p {
  margin: 0;
}
.assistant-review__goal {
  display: grid;
  gap: 3px;
}
.assistant-review__goal p {
  overflow-wrap: anywhere;
  white-space: pre-wrap;
  font-size: 13px;
  line-height: 1.65;
}
.assistant-review__checks {
  display: grid;
  gap: 6px;
}
.assistant-review__failures,
.assistant-review__all-checks {
  display: grid;
  gap: 5px;
  margin: 0;
  padding: 0;
  list-style: none;
  color: var(--tp-text-muted);
  font-size: 11.5px;
  line-height: 1.6;
}
.assistant-review__failures li {
  padding: 7px 9px;
  border-left: 2px solid var(--tp-danger);
  background: var(--tp-danger-soft);
  color: var(--tp-danger-content);
}
.assistant-review__failures strong {
  margin-right: 6px;
}
.assistant-review__hunks {
  display: grid;
  gap: 10px;
}
.assistant-hunk {
  display: grid;
  gap: 9px;
  padding: 10px 12px;
  border: 1px dashed var(--tp-pencil-line);
  border-radius: var(--tp-radius-s);
  background: var(--tp-pencil-soft);
  font-size: 13px;
  line-height: 1.8;
  overflow-wrap: anywhere;
}
.assistant-hunk[data-decision="rejected"] {
  background: var(--tp-surface);
  opacity: 0.72;
}
.assistant-review__state,
.assistant-review__error {
  margin: 0;
  padding: 8px 10px;
  font-size: 12.5px;
  line-height: 1.6;
}
.assistant-review__state {
  border-left: 2px solid var(--tp-stale);
  background: var(--tp-stale-soft);
}
.assistant-review__error {
  border-left: 2px solid var(--tp-danger);
  background: var(--tp-danger-soft);
  color: var(--tp-danger-content);
}
.assistant-review__notice {
  margin: 0;
  color: var(--tp-success-content);
  font-size: 12.5px;
}
@media (max-width: 420px) {
  .assistant-hunk__actions .tp-btn,
  .assistant-review__actions .tp-btn {
    min-height: 36px;
  }
}
</style>
