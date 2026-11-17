<script setup lang="ts">
import { computed, onScopeDispose, ref, shallowRef, watch } from "vue";
import TpButton from "@/components/ui/TpButton.vue";
import DiffText from "@/components/domain/DiffText.vue";
import type { BackendServices, RevisionRead, RevisionDecision } from "@/services";
import { ApiError, asApiError } from "@/services/errors";
import { beginJobRequest, confirmJobRequest } from "@/lab/components/integration/jobsRequests";
import { panelMotionHooks } from "@/lab/components/integration/motion";

const props = defineProps<{ services: BackendServices; projectId: string; documentId: string; candidateId: string; currentVersion: number }>();
const candidate = shallowRef<RevisionRead>();
const loading = ref(false);
const busy = ref(false);
const error = ref("");
const notice = ref("");
const mustReload = ref(false);
const uncertainCommand = ref(false);
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
const checkLabels: Record<string, string> = {
  version: "基础版本",
  range: "选区范围",
  number: "数字与单位",
  citation: "引用",
  formula: "公式",
  lock: "锁定文字",
  overlap: "修改范围",
  structure: "正文结构",
};
const stateLabels: Record<string, string> = {
  generating: "候选生成中",
  ready: "待审阅",
  invalid: "未通过保护校验",
  failed: "生成失败",
  cancelled: "已取消",
  applied: "已采纳",
  undone: "已撤销",
};
let request: AbortController | undefined;
let command: { input: { command_id: string; expected_revision: number; decisions: RevisionDecision[] }; scope: string } | undefined;
async function load() {
  request?.abort();
  const controller = new AbortController();
  request = controller;
  loading.value = true;
  error.value = "";
  try {
    const result = await props.services.revisions.get(props.projectId, props.documentId, props.candidateId, controller.signal);
    if (!controller.signal.aborted) {
      if (result.producer !== "model_run") throw new ApiError("INVALID_RESPONSE");
      candidate.value = result;
      decisions.value = Object.fromEntries(
        result.patches.map((patch) => [patch.id, result.decisions.find((item) => item.patch_id === patch.id)?.decision ?? "pending"]),
      );
      mustReload.value = false;
    }
  } catch (problem) {
    if (!controller.signal.aborted) error.value = asApiError(problem).message;
  } finally {
    if (!controller.signal.aborted) loading.value = false;
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
  const controller = new AbortController();
  request = controller;
  busy.value = true;
  error.value = "";
  notice.value = "";
  try {
    await props.services.revisions.decide(props.projectId, props.documentId, props.candidateId, pending.input, controller.signal);
    if (controller.signal.aborted) return;
    confirmJobRequest(pending.scope, pending.input.command_id);
    command = undefined;
    uncertainCommand.value = false;
    notice.value = "审阅决定已保存；正式正文未修改。";
    busy.value = false;
    await load();
  } catch (problem) {
    if (!controller.signal.aborted) {
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
    if (!controller.signal.aborted) busy.value = false;
  }
}
watch(
  () => [props.projectId, props.documentId, props.candidateId],
  () => {
    command = undefined;
    uncertainCommand.value = false;
    candidate.value = undefined;
    busy.value = false;
    notice.value = "";
    void load();
  },
  { immediate: true },
);
onScopeDispose(() => request?.abort());
</script>

<template>
  <section class="studio-stack assistant-review" aria-label="助手建议审阅">
    <h3 class="tp-heading">助手建议审阅</h3>
    <p class="studio-notice">此处只保存审阅决定；采纳请在写作页的助手面板中进行。助手不会自动改写正文。</p>
    <p v-if="loading" role="status" class="tp-caption">正在读取真实运行产生的候选…</p>
    <p v-if="stale" role="alert" class="studio-notice">候选基于旧正文版本，请重新选取当前已保存文字并发起新运行。</p>
    <template v-if="candidate"
      ><p class="tp-caption">{{ stateLabels[candidate.status] ?? candidate.status }} · 基于正式稿 v{{ candidate.base_version }} · 当前 v{{ currentVersion }}</p>
      <ul class="assistant-checks">
        <li v-for="(check, index) in candidate.checks" :key="index">
          {{ checkLabels[check.rule] ?? check.rule }}：{{ check.result === "pass" ? "通过" : check.result === "fail" ? "失败" : "不支持" }} · {{ check.detail }}
        </li>
      </ul>
      <article v-for="patch in candidate.patches" :key="patch.id" class="assistant-hunk">
        <DiffText
          :segments="[
            { t: 'del', text: patch.before },
            { t: 'ins', text: patch.after },
          ]"
        />
        <p class="tp-caption">本项决定：{{ decisions[patch.id] === "accepted" ? "接受" : decisions[patch.id] === "rejected" ? "拒绝" : "未决定" }}</p>
        <div class="screen-actions">
          <TpButton size="sm" :disabled="!editable || acceptanceBlocked(patch.id)" @click="decisions[patch.id] = 'accepted'">接受此建议</TpButton
          ><TpButton size="sm" :disabled="!editable" @click="decisions[patch.id] = 'rejected'">拒绝此建议</TpButton
          ><TpButton size="sm" variant="ghost" :disabled="!editable" @click="decisions[patch.id] = 'pending'">取消此项决定</TpButton>
        </div>
      </article>
      <div class="screen-actions">
        <TpButton size="sm" :disabled="busy || loading || mustReload || (stale && !uncertainCommand)" :loading="busy" @click="save">{{
          uncertainCommand ? "使用原审阅命令确认" : "保存审阅决定"
        }}</TpButton
        ><TpButton v-if="mustReload" size="sm" @click="load">载入最新候选</TpButton
        ><TpButton v-else size="sm" variant="ghost" :disabled="busy || loading || uncertainCommand" @click="load">刷新候选</TpButton>
      </div></template
    >
    <Transition name="tp-swap" v-bind="panelMotionHooks"><p v-if="error" :key="error" role="alert" class="studio-notice">{{ error }}</p></Transition>
    <p v-if="notice" role="status" class="tp-caption">{{ notice }}</p>
  </section>
</template>

<style scoped>
.assistant-review {
  padding: 16px;
  border: 1px solid var(--tp-pencil-line);
  border-radius: var(--tp-radius-s);
  background: var(--tp-pencil-soft);
}
.assistant-checks {
  padding-left: 18px;
  font-size: 12px;
  line-height: 1.7;
}
.assistant-hunk {
  display: grid;
  gap: 10px;
  padding: 14px;
  background: var(--tp-surface);
  border: 1px solid var(--tp-line);
  border-radius: var(--tp-radius-s);
  font-size: 13px;
  line-height: 1.8;
}
</style>
