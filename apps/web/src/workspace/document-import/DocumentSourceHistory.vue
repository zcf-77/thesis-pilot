<script setup lang="ts">
import { onScopeDispose, ref, shallowRef, watch } from "vue";
import type { BackendServices } from "@/services";
import { asApiError } from "@/services/errors";
import DocumentSourceDetails from "./DocumentSourceDetails.vue";
const props = defineProps<{ services: BackendServices; projectId: string; documentId: string; version: number }>();
type Source = Awaited<ReturnType<BackendServices["documentSources"]["version"]>>;
const source = shallowRef<Source>();
const loading = ref(false);
const missing = ref(false);
const error = ref("");
let request: AbortController | undefined;
async function load() {
  request?.abort();
  const controller = new AbortController();
  request = controller;
  loading.value = true;
  missing.value = false;
  source.value = undefined;
  error.value = "";
  try {
    const result = await props.services.documentSources.version(props.projectId, props.documentId, props.version, controller.signal);
    if (!controller.signal.aborted) source.value = result;
  } catch (problem) {
    if (!controller.signal.aborted) {
      const issue = asApiError(problem);
      if (issue.code === "DOCUMENT_SOURCE_NOT_FOUND") missing.value = true;
      else error.value = issue.message;
    }
  } finally {
    if (!controller.signal.aborted) loading.value = false;
  }
}
watch(
  () => [props.projectId, props.documentId, props.version],
  () => void load(),
  { immediate: true },
);
onScopeDispose(() => request?.abort());
</script>
<template>
  <DocumentSourceDetails
    :services="services"
    :project-id="projectId"
    :source="source"
    :version="version"
    :loading="loading"
    :missing="missing"
    :error="error"
    historical
    @retry="load"
  />
</template>
