<script setup lang="ts">
import { RouterView } from "vue-router";
import TpState from "@/components/ui/TpState.vue";
import { useBackendServices } from "@/services/runtime";
import WorkspaceUnlock from "./WorkspaceUnlock.vue";
import { useWorkspaceSession } from "./useWorkspaceSession";
import "@/lab/screens/screens.css";
import "./workspace.css";

const runtime = useBackendServices();
const services = runtime.mode === "http" ? runtime.services : null;
const { session, gate, pending, message, exitError, verify, open, close, applyProfile } = useWorkspaceSession();
</script>

<template>
  <main v-if="!services" class="workspace-gate">
    <TpState kind="error" title="工作区服务未配置" desc="请通过工作区服务地址进入。" />
  </main>
  <RouterView v-else-if="session" v-slot="{ Component }">
    <component
      :is="Component"
      :key="session.workspace_id"
      :session="session"
      :services="services"
      :exiting="pending === 'close'"
      :exit-error="exitError"
      @exit="close"
      @profile-saved="applyProfile"
    />
  </RouterView>
  <WorkspaceUnlock
    v-else
    :key="gate"
    :state="gate === 'active' ? 'checking' : gate"
    :message="message"
    :busy="pending === 'open'"
    @unlock="open"
    @retry="verify"
  />
</template>
