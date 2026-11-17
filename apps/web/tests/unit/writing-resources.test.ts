import { describe, expect, it, vi } from "vite-plus/test";
import type { DocsModel } from "@muffin-office/core/types";
import { dehydrateResources, hydrateResources } from "../../src/workspace/writing/resources.ts";

const png = `tp-resource:${"a".repeat(64)}`;
const gif = `tp-resource:${"b".repeat(64)}`;
const missing = `tp-resource:${"c".repeat(64)}`;
const model = {
  kind: "docs",
  schemaVersion: 1,
  id: "d",
  theme: { name: "minimal" },
  sections: [{ id: "s", blocks: [] }],
  resources: [
    { id: "r-png", mime: "image/png", data: { kind: "uri", value: png } },
    { id: "r-gif", mime: "image/gif", data: { kind: "uri", value: gif } },
    { id: "r-missing", mime: "image/jpeg", data: { kind: "uri", value: missing } },
  ],
} as unknown as DocsModel;

describe("写作页图片资源：打开时换成字节，快照前换回引用", () => {
  it("只换可绘制且读取成功的资源；换回后与原快照一致", async () => {
    const fetch = vi.fn(async (sha: string) => {
      if (sha === "c".repeat(64)) throw new Error("404");
      return new Blob([new Uint8Array([137, 80, 78, 71])], { type: "image/png" });
    });
    const hydrated = await hydrateResources(model, fetch);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(hydrated.model.resources!.map((item) => item.data.kind)).toEqual(["bytes", "uri", "uri"]);
    expect(hydrated.model.resources![0]!.data.value).toBe(btoa(String.fromCharCode(137, 80, 78, 71)));
    expect([...hydrated.uris]).toEqual([["r-png", png]]);
    expect(dehydrateResources(hydrated.model, hydrated.uris)).toEqual(model);
  });

  it("响应类型与资源声明不符时保留原引用", async () => {
    const hydrated = await hydrateResources(model, async () => new Blob(["x"], { type: "image/jpeg" }));
    expect(hydrated.model.resources![0]!.data).toEqual({ kind: "uri", value: png });
    expect(hydrated.uris.size).toBe(1);
  });
});
