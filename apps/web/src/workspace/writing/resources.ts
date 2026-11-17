import type { DocsModel } from "@muffin-office/core/types";

/**
 * 正文快照里的图片只以 `tp-resource:<sha256>` 引用内容寻址存储，字节不进快照；
 * MuffinOffice 纸面只绘制内嵌字节（PNG/JPEG），否则显示“未嵌入”占位。
 * 打开正文时把可显示的引用换成字节交给编辑器，生成快照前再换回原引用，快照与服务端契约不变。
 */
const RESOURCE_URI = /^tp-resource:([0-9a-f]{64})$/;
const DRAWABLE = new Set(["image/png", "image/jpeg"]);

type Resource = NonNullable<DocsModel["resources"]>[number];
export type ResourceFetcher = (sha256: string) => Promise<Blob>;

export interface HydratedModel {
  model: DocsModel;
  /** 资源 ID → 快照中的原引用；只含本次换成字节的资源。 */
  uris: ReadonlyMap<string, string>;
}

async function base64Of(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000) binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  return btoa(binary);
}

/** 读取失败或类型不符的资源保留原引用（纸面显示占位），不影响正文打开。 */
export async function hydrateResources(model: DocsModel, fetch: ResourceFetcher): Promise<HydratedModel> {
  const resources = model.resources ?? [];
  const uris = new Map<string, string>();
  const next = await Promise.all(
    resources.map(async (resource): Promise<Resource> => {
      const value = resource.data.kind === "uri" ? String(resource.data.value) : "";
      const digest = RESOURCE_URI.exec(value)?.[1];
      if (!digest || !DRAWABLE.has(resource.mime)) return resource;
      try {
        const blob = await fetch(digest);
        if (blob.type && blob.type !== resource.mime) return resource;
        uris.set(resource.id, value);
        return { ...resource, data: { kind: "bytes", value: await base64Of(blob) } } as Resource;
      } catch {
        return resource;
      }
    }),
  );
  return uris.size ? { model: { ...model, resources: next }, uris } : { model, uris };
}

/** hydrateResources 的逆：把换入的字节恢复成原引用；其他资源原样保留（交由快照校验）。 */
export function dehydrateResources(model: DocsModel, uris: ReadonlyMap<string, string>): DocsModel {
  if (!uris.size || !model.resources?.length) return model;
  return {
    ...model,
    resources: model.resources.map((resource) => {
      const uri = uris.get(resource.id);
      return uri && resource.data.kind === "bytes" ? ({ ...resource, data: { kind: "uri", value: uri } } as Resource) : resource;
    }),
  };
}
