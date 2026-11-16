<script setup lang="ts">
import { computed, useId } from "vue";
import { PhFileText } from "@phosphor-icons/vue";
import TpIcon from "@/components/ui/TpIcon.vue";
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
  if (props.material.removed) return "已移除 · 历史保留";
  if (!props.material.linked) return "未关联项目";
  if (props.info?.error) return "部分信息读取失败";
  if (state.value.active) return state.value.key === "queued" ? "排队等待解析" : "正在读取文本";
  if (state.value.key === "partial") return "有内容待核对";
  if (props.info?.originalTotal) return `${props.info.originalTotal} 个原件版本 · ${props.info.parseTotal ?? 0} 个解析版本`;
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
    <span class="library-file-icon" aria-hidden="true"
      ><TpIcon :icon="PhFileText" :size="25" /><small>{{ materialExtension(info?.original?.filename) }}</small></span
    ><span class="library-file-copy"
      ><span class="library-file-title">{{ material.name }}</span
      ><span :id="metaId" class="library-file-meta tp-caption"
        >{{ category
        }}<template v-if="info?.original"><i />{{ materialSize(info.original.byte_size) }}<i /><TpVersion :v="info.original.version" prefix="原件 " /></template
        ><span class="sr-only">，{{ state.label }}<template v-if="secondary">，{{ secondary }}</template></span></span
      ></span
    ><span class="library-file-state" aria-hidden="true"
      ><TpStatus :tone="state.tone" :label="state.label" :live="state.live" size="sm" /><small v-if="secondary">{{ secondary }}</small></span
    >
  </button>
</template>

<style scoped>
.library-file-row {
  display: grid;
  grid-template-columns: 44px minmax(0, 1fr) auto;
  gap: 16px;
  align-items: center;
  width: 100%;
  text-align: left;
  padding: 24px;
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
}
.library-file-row.is-selected::before {
  content: "";
  position: absolute;
  inset: 16px auto 16px 0;
  width: 3px;
  background: var(--tp-ink);
}
.library-file-row.is-muted .library-file-title {
  color: var(--tp-text-muted);
}
.library-file-row:disabled {
  cursor: default;
}
.library-file-icon {
  display: grid;
  place-items: center;
  gap: 2px;
  padding: 8px 4px;
  border: 1px solid var(--tp-line-strong);
  border-radius: var(--tp-radius-xs);
  color: var(--tp-text-muted);
  background: var(--tp-surface);
}
.library-file-icon small {
  text-transform: uppercase;
  font-family: var(--tp-font-mono);
  font-size: 9px;
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
  gap: 8px;
  align-items: center;
  margin-top: 8px;
}
.library-file-meta i {
  width: 2px;
  height: 2px;
  background: var(--tp-text-faint);
  border-radius: 50%;
}
.library-file-state {
  display: grid;
  justify-items: end;
  gap: 8px;
}
.library-file-state small {
  color: var(--tp-text-muted);
  font-size: 11px;
}
@media (max-width: 1200px) {
  .library-file-row {
    gap: 12px;
    padding: 20px 16px;
  }
}
@media (max-width: 640px) {
  .library-file-row {
    grid-template-columns: 36px minmax(0, 1fr);
    gap: 8px 12px;
    padding: 20px 16px;
  }
  .library-file-icon {
    grid-row: span 2;
    align-self: start;
  }
  .library-file-state {
    grid-column: 2;
    display: flex;
    justify-content: space-between;
    align-items: center;
  }
  .library-file-title {
    font-size: 13px;
  }
  .library-file-meta {
    font-size: 11px;
    margin-top: 4px;
  }
}
</style>
