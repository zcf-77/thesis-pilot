import { describe, expect, it } from "vite-plus/test";
import {
  MAX_MATERIAL_BYTES,
  bytesToBase64,
  materialFileError,
  materialFormat,
  materialTaskMatches,
  taskUpdateAllowed,
} from "../../src/workspace/materials/materialPresentation.ts";

describe("正式资料上传与解析状态边界", () => {
  it("在发送前拒绝空文件与超限文件，8 MiB边界可用", () => {
    const file = { name: "自制要求.txt", type: "text/plain", size: 1 };
    expect(materialFileError({ ...file, size: 0 })).toContain("为空");
    expect(materialFileError({ ...file, size: MAX_MATERIAL_BYTES })).toBe("");
    expect(materialFileError({ ...file, size: MAX_MATERIAL_BYTES + 1 })).toContain("8 MiB");
  });
  it("PDF只识别原件格式，不将识别扩展名当成已支持解析", () => {
    expect(materialFormat({ name: "自制模板.DOCX", type: "" })).toBe("docx");
    expect(materialFormat({ name: "自制要求.pdf", type: "application/pdf" })).toBe("pdf");
    expect(materialFileError({ name: "工具.exe", type: "application/octet-stream", size: 12 })).toContain("请选择");
  });
  it("原件编码保留所有字节并跨越分片边界", () => {
    const bytes = Uint8Array.from({ length: 65539 }, (_, index) => index % 256);
    const decoded = Uint8Array.from(atob(bytesToBase64(bytes)), (character) => character.charCodeAt(0));
    expect(decoded).toEqual(bytes);
  });
  it("取消后的迟到解析状态不能重新激活，重试新任务可独立读取", () => {
    const current = { id: "parse-1", status: "cancelled", updated_at: "2026-11-17T16:00:02Z" };
    expect(taskUpdateAllowed(current, { ...current, status: "running", updated_at: "2026-11-17T16:00:01Z" })).toBe(false);
    expect(taskUpdateAllowed(current, { ...current, status: "queued", updated_at: "2026-11-17T16:00:03Z" })).toBe(false);
    expect(taskUpdateAllowed(current, { ...current, id: "parse-2", status: "queued" })).toBe(true);
  });
  it("切换项目或原件后，旧解析任务不能写回新详情", () => {
    const job = { project_id: "project-a", resource_scope: { original_version_id: "original-a" } };
    expect(materialTaskMatches(job, "project-a", "original-a")).toBe(true);
    expect(materialTaskMatches(job, "project-b", "original-a")).toBe(false);
    expect(materialTaskMatches(job, "project-a", "original-b")).toBe(false);
    expect(materialTaskMatches({ project_id: "project-a", resource_scope: null }, "project-a", "original-a")).toBe(false);
    expect(materialFileError({ name: "../sample.txt", size: 12, type: "text/plain" })).toContain("路径");
  });
});
