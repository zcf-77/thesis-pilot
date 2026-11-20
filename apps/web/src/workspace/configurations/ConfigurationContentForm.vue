<script setup lang="ts">
import TpField from "@/components/ui/TpField.vue";
import TpSelect from "@/components/ui/TpSelect.vue";
import type { SelectOption } from "@/components/ui/selectControl";
import type { ConfigurationContent, Capability, PromptVariable, AgentTool } from "./configurationEditor";

defineProps<{ disabled: boolean; apiVersions: SelectOption[]; modelVersions: SelectOption[]; promptVersions: SelectOption[]; credentialStatus: string }>();
const content = defineModel<ConfigurationContent>({ required: true });
const inputSchema = defineModel<string>("inputSchema", { required: true });
const outputSchema = defineModel<string>("outputSchema", { required: true });
const capabilities: { value: Capability; label: string }[] = [
  { value: "text", label: "文本" },
  { value: "search", label: "检索" },
  { value: "format", label: "格式" },
  { value: "plan", label: "规划" },
  { value: "review", label: "评审" },
];
const variables: { value: PromptVariable; label: string }[] = [
  { value: "context", label: "context · 背景" },
  { value: "goal", label: "goal · 目标" },
  { value: "requirements", label: "requirements · 要求" },
  { value: "materials", label: "materials · 资料" },
];
const tools: { value: AgentTool; label: string }[] = [
  { value: "read_context", label: "读取显式输入" },
  { value: "return_suggestion", label: "返回建议" },
];
function checked(event: Event) {
  return (event.target as HTMLInputElement).checked;
}
function toggle<T extends string>(values: T[], value: T, on: boolean): T[] {
  return on ? [...new Set([...values, value])] : values.filter((item) => item !== value);
}
</script>

<template>
  <div class="configuration-fields">
    <template v-if="content.kind === 'api'">
      <TpField v-slot="{ id }" label="供应商"><input :id="id" value="DeepSeek" class="tp-input" readonly /></TpField>
      <TpField v-slot="{ id }" label="官方接口地址"><input :id="id" :value="content.base_url" class="tp-input" readonly /></TpField>
      <div class="configuration-credential">
        <span class="tp-field__label">服务器凭据</span>
        <p class="tp-caption">{{ credentialStatus }} 凭据值不在此显示。</p>
      </div>
      <TpField v-slot="{ id }" label="超时秒数" hint="1–300 秒。"
        ><input :id="id" v-model.number="content.timeout_seconds" class="tp-input" inputmode="numeric" :readonly="disabled"
      /></TpField>
      <TpField v-slot="{ id }" label="显式重试预算" hint="0–3 次，仅用户发起重试时使用，不自动重试。"
        ><input :id="id" v-model.number="content.max_retries" class="tp-input" inputmode="numeric" :readonly="disabled"
      /></TpField>
      <TpField v-slot="{ id }" label="每分钟请求上限" hint="1–1000 次。"
        ><input :id="id" v-model.number="content.rate_limit_per_minute" class="tp-input" inputmode="numeric" :readonly="disabled"
      /></TpField>
    </template>
    <template v-else-if="content.kind === 'model'">
      <TpField v-slot="{ id }" label="接口版本" hint="明确绑定不可变版本。"
        ><TpSelect :id="id" v-model="content.api_version_id" :options="apiVersions" :disabled="disabled"
      /></TpField>
      <TpField v-slot="{ id }" label="模型型号"
        ><TpSelect
          :id="id"
          v-model="content.model_code"
          :options="[
            { value: 'deepseek-flash', label: 'deepseek-flash' },
            { value: 'deepseek-v4-pro', label: 'deepseek-v4-pro' },
          ]"
          :disabled="disabled"
      /></TpField>
      <TpField v-slot="{ id }" label="上下文保守上限" hint="按 UTF-8 字节保守检查，非精确 token 计数。"
        ><input :id="id" v-model.number="content.context_limit" class="tp-input" inputmode="numeric" :readonly="disabled"
      /></TpField>
      <TpField v-slot="{ id }" label="温度" hint="0–2。"
        ><input :id="id" v-model.number="content.temperature" class="tp-input" inputmode="decimal" :readonly="disabled"
      /></TpField>
      <TpField v-slot="{ id }" label="最大输出 token" hint="1–8192。"
        ><input :id="id" v-model.number="content.max_output_tokens" class="tp-input" inputmode="numeric" :readonly="disabled"
      /></TpField>
      <fieldset class="configuration-fieldset configuration-checks">
        <legend class="tp-caption">模型能力</legend>
        <label v-for="item in capabilities" :key="item.value"
          ><input
            type="checkbox"
            class="checkbox checkbox-sm"
            :checked="content.capabilities.includes(item.value)"
            :disabled="disabled"
            @change="content.capabilities = toggle(content.capabilities, item.value, checked($event))"
          />{{ item.label }}</label
        >
      </fieldset>
    </template>
    <template v-else-if="content.kind === 'prompt'">
      <TpField v-slot="{ id }" label="提示词模板" hint="使用双花括号变量，如 {{context}}。" class="configuration-wide">
        <textarea :id="id" v-model="content.template" class="tp-input" rows="6" :readonly="disabled" />
      </TpField>
      <fieldset class="configuration-fieldset configuration-checks configuration-wide">
        <legend class="tp-caption">声明变量</legend>
        <label v-for="item in variables" :key="item.value"
          ><input
            type="checkbox"
            class="checkbox checkbox-sm"
            :checked="content.variables.includes(item.value)"
            :disabled="disabled"
            @change="content.variables = toggle(content.variables, item.value, checked($event))"
          />{{ item.label }}</label
        >
      </fieldset>
    </template>
    <template v-else>
      <TpField v-slot="{ id }" label="智能体角色"
        ><TpSelect
          :id="id"
          v-model="content.role"
          :disabled="disabled"
          :options="[
            { value: 'general', label: '通用助手' },
            { value: 'literature', label: '文献助手' },
            { value: 'content', label: '内容助手' },
            { value: 'format', label: '格式助手' },
            { value: 'progress', label: '进度助手' },
            { value: 'review', label: '评审助手' },
          ]"
      /></TpField>
      <TpField v-slot="{ id }" label="模型版本"><TpSelect :id="id" v-model="content.model_version_id" :options="modelVersions" :disabled="disabled" /></TpField>
      <TpField v-slot="{ id }" label="提示词版本"
        ><TpSelect :id="id" v-model="content.prompt_version_id" :options="promptVersions" :disabled="disabled"
      /></TpField>
      <TpField v-slot="{ id }" label="智能体职责" class="configuration-wide">
        <textarea :id="id" v-model="content.instructions" class="tp-input" rows="4" :readonly="disabled" />
      </TpField>
      <fieldset class="configuration-fieldset configuration-checks configuration-wide">
        <legend class="tp-caption">允许的操作</legend>
        <label v-for="item in tools" :key="item.value"
          ><input
            type="checkbox"
            class="checkbox checkbox-sm"
            :checked="content.allowed_tools.includes(item.value)"
            :disabled="disabled"
            @change="content.allowed_tools = toggle(content.allowed_tools, item.value, checked($event))"
          />{{ item.label }}</label
        >
      </fieldset>
    </template>
    <template v-if="content.kind === 'prompt' || content.kind === 'agent'">
      <TpField v-slot="{ id }" label="输入结构 JSON" hint="字段到类型的映射；空对象表示不额外校验。">
        <textarea :id="id" v-model="inputSchema" class="tp-input configuration-mono" rows="3" :readonly="disabled" />
      </TpField>
      <TpField v-slot="{ id }" label="输出结构 JSON" hint="空对象为纯文本；非空时程序校验返回 JSON。">
        <textarea :id="id" v-model="outputSchema" class="tp-input configuration-mono" rows="3" :readonly="disabled" />
      </TpField>
    </template>
    <TpField v-slot="{ id }" label="配置说明" class="configuration-wide">
      <textarea :id="id" v-model="content.description" class="tp-input" rows="2" :readonly="disabled" />
    </TpField>
  </div>
</template>

<style scoped>
.configuration-fields {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px 16px;
}
.configuration-wide {
  grid-column: 1 / -1;
}
.configuration-fieldset {
  padding: 0;
  margin: 0;
  border: 0;
  min-width: 0;
}
.configuration-checks {
  display: flex;
  flex-wrap: wrap;
  align-content: start;
  gap: 8px 16px;
}
.configuration-checks legend {
  margin-bottom: 8px;
}
.configuration-checks label {
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 28px;
  font-size: 13px;
  cursor: pointer;
}
.configuration-credential {
  display: grid;
  align-content: start;
  gap: 8px;
}
.configuration-credential p {
  min-height: 36px;
  padding: 8px 10px;
  border: 1px dashed var(--tp-line);
  border-radius: var(--tp-radius-s);
  background: var(--tp-surface-sunken);
}
textarea {
  width: 100%;
  resize: vertical;
}
.configuration-mono {
  font-family: var(--tp-font-mono);
}
@media (max-width: 700px) {
  .configuration-fields {
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>
