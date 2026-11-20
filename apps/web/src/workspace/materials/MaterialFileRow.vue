<script setup lang="ts">
import { computed, useId } from "vue";
import TpStatus from "@/components/ui/TpStatus.vue";
import TpVersion from "@/components/ui/TpVersion.vue";
import type { MaterialRowInfo } from "./useMaterialCatalog";
import { materialCategories, materialExtension, materialParseState, materialSize } from "./materialPresentation";

type Material = MaterialRowInfo["material"];
const props = defineProps<{ material: Material; info?: MaterialRowInfo; selected: boolean; disabled?: boolean }>();
defineEmits<{ select: [material: Material] }>();
const metaId = useId();
const state = computed(() => materialParseState(props.info?.job, props.info?.parse, !props.info || props.info.loading));
const category = computed(() => materialCategories.find((item) => item.value === props.material.kind)?.label ?? props.material.kind);
const secondary = computed(() => {
  if (props.material.removed) return "已移出 · 历史保留";
  if (!props.material.linked) return "未关联项目";
  if (props.info?.error) return "部分信息读取失败";
  if (state.value.active) return state.value.key === "queued" ? "等待任务执行" : "正在处理当前原件";
  if (state.value.key === "partial") return "有内容待核对";
  if (props.info?.originalTotal && props.info.originalTotal > 1) return `${props.info.originalTotal} 个原件版本`;
  return "";
});
</script>

<template>
  <button
    type="button"
    class="library-file-row"
    :class="{ 'is-selected': selected, 'is-muted': material.removed || !material.linked }"
    :aria-pressed="selected"
    :aria-label="material.name"
    :aria-describedby="metaId"
    :disabled="disabled"
    @click="$emit('select', material)"
  >
    <span class="library-file-copy">
      <span class="library-file-title">{{ material.name }}</span>
      <span :id="metaId" class="library-file-meta tp-caption">
        <span>{{ category }}</span><span class="library-file-format">{{ materialExtension(info?.original?.filename) }}</span>
        <template v-if="info?.original"
          ><span>{{ materialSize(info.original.byte_size) }}</span><TpVersion :v="info.original.version" prefix="原件 "
        /></template>
        <span class="sr-only">，{{ state.label }}<template v-if="secondary">，{{ secondary }}</template></span>
      </span>
    </span>
    <span class="library-file-state" aria-hidden="true">
      <TpStatus :tone="state.tone" :label="state.label" :live="state.live" size="sm" />
      <small v-if="secondary">{{ secondary }}</small>
    </span>
  </button>
</template>

<style scoped>
.library-file-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 12px 16px;
  align-items: start;
  width: 100%;
  text-align: left;
  padding: 20px;
  border-bottom: 1px solid var(--tp-line);
  position: relative;
  transition: background var(--tp-dur-fast);
  color: var(--tp-text);
}
.library-file-row:hover:not(:disabled) {
  background: var(--tp-surface-sunken);
}
.library-file-row.is-selected {
  background: color-mix(in srgb, var(--tp-ink) 4%, var(--tp-surface));
  box-shadow: inset 2px 0 var(--tp-ink);
}
.library-file-row.is-muted .library-file-title {
  color: var(--tp-text-muted);
}
.library-file-row:disabled {
  cursor: not-allowed;
  opacity: 0.56;
}
.library-file-copy {
  min-width: 0;
}
.library-file-title {
  font-weight: 600;
  line-height: 1.55;
  display: block;
  overflow-wrap: anywhere;
}
.library-file-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 12px;
  align-items: center;
  margin-top: 8px;
  color: var(--tp-text-muted);
}
.library-file-format {
  font-family: var(--tp-font-mono);
  font-size: 10px;
}
.library-file-state {
  display: grid;
  justify-items: end;
  gap: 8px;
  max-width: 140px;
}
.library-file-state small {
  color: var(--tp-text-muted);
  font-size: 11px;
  text-align: right;
  overflow-wrap: anywhere;
}
@media (max-width: 640px) {
  .library-file-row {
    grid-template-columns: minmax(0, 1fr);
    gap: 12px;
    padding: 16px;
  }
  .library-file-title {
    font-size: 14px;
  }
  .library-file-meta {
    font-size: 11px;
    margin-top: 4px;
  }
  .library-file-state {
    display: flex;
    justify-content: space-between;
    align-items: center;
    max-width: none;
  }
  .library-file-state small {
    text-align: left;
  }
}
</style>
