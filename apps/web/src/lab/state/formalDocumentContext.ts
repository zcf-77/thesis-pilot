import { inject, onScopeDispose, provide, shallowRef, watch, type InjectionKey, type Ref } from "vue";
import type { BackendServices } from "../../services/index.ts";
import type { RemoteProjectBinding } from "./serviceBinding.ts";
import { createRemoteDocumentController } from "./remoteDocuments.ts";

export type FormalDocumentController = ReturnType<typeof createRemoteDocumentController>;
const contextKey: InjectionKey<Ref<FormalDocumentController | null>> = Symbol("formal-document");
const captureErrorKey: InjectionKey<Ref<string>> = Symbol("formal-editor-capture-error");

export function provideFormalDocument(
  services: BackendServices | null,
  localProjectId: Readonly<Ref<string>>,
  binding: Readonly<Ref<RemoteProjectBinding | undefined>>,
) {
  const controller = shallowRef<FormalDocumentController | null>(null);
  const captureError = shallowRef("");
  watch(
    [localProjectId, () => binding.value?.sourceKey, () => binding.value?.projectId],
    () => {
      controller.value?.dispose();
      captureError.value = "";
      const remote = binding.value;
      controller.value =
        services && remote?.sourceKey === services.sourceKey
          ? createRemoteDocumentController(services, { localProjectId: localProjectId.value, projectId: remote.projectId, sourceKey: remote.sourceKey })
          : null;
    },
    { immediate: true },
  );
  onScopeDispose(() => controller.value?.dispose());
  provide(contextKey, controller);
  provide(captureErrorKey, captureError);
  return controller;
}

export function useFormalDocument() {
  return inject(contextKey, shallowRef<FormalDocumentController | null>(null));
}

export function useFormalEditorCaptureError() {
  return inject(captureErrorKey, shallowRef(""));
}
