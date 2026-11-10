<script setup lang="ts">
import type { AgentKind } from "@/domain/types";
import { agents } from "@/domain/vocab";

/** 会话消息。助手消息不套气泡（它不是聊天对象，是工作记录）；学生消息靠右、带底色。streaming 时末尾有铅笔色光标。 */
defineProps<{ role: "user" | "assistant"; agent?: AgentKind; time?: string; streaming?: boolean; userInitial?: string }>();
</script>

<template>
  <div class="tp-msg" :data-role="role">
    <span v-if="role === 'assistant'" class="tp-avatar tp-avatar--sm" :data-agent="agent ?? 'general'">{{ agents[agent ?? "general"].short }}</span>
    <div class="min-w-0" :class="role === 'user' ? 'max-w-[85%]' : 'flex-1'">
      <p v-if="role === 'assistant'" class="tp-msg__who">{{ agents[agent ?? "general"].name }}<time v-if="time">{{ time }}</time></p>
      <div class="tp-msg__text" :class="{ 'tp-caret': streaming }"><slot /></div>
    </div>
  </div>
</template>
