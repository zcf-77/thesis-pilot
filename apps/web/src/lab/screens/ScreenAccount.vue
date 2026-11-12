<script setup lang="ts">
import TpDatePicker from "@/components/ui/TpDatePicker.vue";
import { ref } from "vue";
import TpButton from "@/components/ui/TpButton.vue";
import TpField from "@/components/ui/TpField.vue";
import TpStatus from "@/components/ui/TpStatus.vue";
import TpDialog from "@/components/ui/TpDialog.vue";
import { usePreviewWorkspaceStore } from "../state/previewWorkspace";
const workspace = usePreviewWorkspaceStore();
const name = ref(workspace.userName);
const message = ref("");
const resetOpen = ref(false);
function save() {
  if (!name.value.trim()) {
    message.value = "请填写演示昵称。";
    return;
  }
  workspace.userName = name.value.trim();
  message.value = workspace.persistNow() ? "昵称与当前偏好已保存到本机。" : workspace.saveError;
}
function reset() {
  const success = workspace.resetWorkspace();
  resetOpen.value = false;
  message.value = success ? "已恢复自制样例。" : workspace.saveError;
}
</script>
<template>
  <div class="screen-page">
    <header class="screen-heading">
      <div>
        <p class="tp-label">Preferences · 按自己的节奏</p>
        <h1 class="tp-display mt-3">账户与偏好</h1>
        <p class="screen-lead">让提醒有分寸，让专注不被打断。</p>
      </div>
      <TpStatus tone="info" label="演示账户" />
    </header>
    <div class="screen-columns">
      <section class="screen-panel">
        <header class="screen-panel__head">
          <h2 class="tp-subheading">个人偏好</h2>
          <span class="tp-caption">保存在本机</span>
        </header>
        <form class="studio-body studio-stack" @submit.prevent="save" @keydown.esc="name = workspace.userName">
          <TpField v-slot="{ id }" label="演示昵称" required><input :id="id" v-model="name" class="tp-input" maxlength="40" /></TpField>
          <label class="studio-check"
            ><input v-model="workspace.notifications" type="checkbox" class="checkbox checkbox-primary checkbox-sm" /><span
              ><b>接受主动建议</b><small>只在需要留意的节点提醒，随时可关闭。</small></span
            ></label
          >
          <div class="studio-form-grid">
            <TpField v-slot="{ id }" label="静默开始"><TpDatePicker :id="id" v-model="workspace.quietStart" type="time" /></TpField
            ><TpField v-slot="{ id }" label="静默结束"><TpDatePicker :id="id" v-model="workspace.quietEnd" type="time" /></TpField>
          </div>
          <p class="tp-caption">提醒开关和静默时间即时保存；昵称点击保存后生效。已延后的建议可在收件箱重新查看，外观由底部统一切换。</p>
          <div class="screen-actions">
            <TpButton type="submit" variant="primary">保存偏好</TpButton
            ><RouterLink class="studio-link" to="/screens/inbox?tab=snoozed">查看已延后建议 ↗</RouterLink>
          </div>
          <Transition name="tp-swap" mode="out-in">
            <p :key="message" v-if="message" role="status" class="tp-caption">{{ message }}</p>
          </Transition>
        </form>
      </section>
      <aside class="studio-stack">
        <section class="screen-panel studio-body">
          <p class="tp-label">Session</p>
          <h2 class="tp-subheading mt-3">会话与文稿</h2>
          <p class="studio-copy">当前正文 v{{ workspace.current.document.version }} 自动保存在本机。退出不会删除，刷新可以继续；换设备前请下载备份。</p>
          <Transition name="tp-swap" mode="out-in">
            <p :key="workspace.saveError" v-if="workspace.saveStatus === 'failed'" role="alert" class="studio-notice">{{ workspace.saveError }}</p>
          </Transition>
          <div class="studio-stack">
            <TpButton @click="workspace.sessionActive = false">退出演示会话</TpButton
            ><TpButton variant="ghost" @click="workspace.sessionActive = false">预览会话失效</TpButton
            ><RouterLink class="studio-link" to="/screens/export">下载项目备份 ↗</RouterLink>
          </div>
        </section>
        <section class="screen-panel studio-body studio-stack">
          <p class="tp-label">Local data</p>
          <h2 class="tp-subheading">本机保存与恢复</h2>
          <Transition name="tp-swap" mode="out-in">
            <p :key="workspace.saveStatus" class="tp-caption">
              {{ workspace.saveStatus === "saved" ? "更改已保存在本机。" : workspace.saveStatus === "failed" ? "保存失败，当前内容仍保留。" : "正在保存更改…" }}
            </p>
          </Transition>
          <Transition name="tp-swap">
            <TpButton v-if="workspace.saveStatus === 'failed' && !workspace.storageRecoveryRequired" @click="workspace.retrySave()">重试本地保存</TpButton>
          </Transition>
          <TpButton variant="ghost" @click="resetOpen = true">重置为自制样例</TpButton>
          <details class="tp-caption">
            <summary>预览场景 · 本地存储失败</summary>
            <label class="studio-check mt-3"
              ><input v-model="workspace.simulateStorageFailure" type="checkbox" class="checkbox checkbox-sm" /><span>模拟存储写入失败</span></label
            >
            <TpButton size="sm" class="mt-3" @click="workspace.persistNow()">检查本地保存</TpButton>
          </details>
        </section>
        <p class="tp-caption">这里展示账户与会话交互，不提供账号验证、密码找回或教师权限。</p>
      </aside>
    </div>
    <TpDialog v-model:open="resetOpen" title="重置本机项目数据">
      <p class="studio-copy">将移除本机所有项目、正文、任务与历史，并重新建立自制样例。请先下载需要保留的项目备份；取消不会改变任何数据。</p>
      <div class="screen-actions mt-4">
        <RouterLink class="tp-btn tp-btn--outline" to="/screens/export" @click="resetOpen = false">先去备份</RouterLink>
        <TpButton variant="ghost" @click="resetOpen = false">取消</TpButton>
        <TpButton variant="primary" @click="reset">确认重置</TpButton>
      </div>
    </TpDialog>
  </div>
</template>
