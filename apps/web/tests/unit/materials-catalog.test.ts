import { effectScope } from "vue";
import { describe, expect, it, vi } from "vite-plus/test";
import type { BackendServices } from "../../src/services/index.ts";
import { ApiError } from "../../src/services/errors.ts";
import {
  highlightParts,
  materialExtension,
  materialFragments,
  materialParseState,
  materialStem,
  templateScope,
  templateValue,
} from "../../src/workspace/materials/materialPresentation.ts";
import { jobOriginalId } from "../../src/workspace/materials/useMaterialCatalog.ts";
import { useSourceBinding } from "../../src/workspace/materials/useSourceBinding.ts";

describe("资料目录行与详情的状态推导", () => {
  it("进行中的任务优先，其次是最新解析摘要，最后是失败/取消/未知", () => {
    expect(materialParseState({ status: "running" }, { status: "complete" })).toMatchObject({ key: "running", tone: "info", active: true });
    expect(materialParseState({ status: "queued" }, undefined).label).toBe("等待解析");
    expect(materialParseState({ status: "failed" }, { status: "partial" })).toMatchObject({ key: "partial", tone: "warning" });
    expect(materialParseState({ status: "failed", error_code: "MATERIAL_UNSUPPORTED_TYPE" }, undefined)).toMatchObject({ key: "unsupported", tone: "ghost" });
    expect(materialParseState({ status: "failed", error_code: "JOB_EXECUTION_TIMEOUT" }, undefined).key).toBe("failed");
    expect(materialParseState({ status: "cancelled" }, undefined).tone).toBe("ghost");
    expect(materialParseState(undefined, undefined, true).key).toBe("loading");
    expect(materialParseState(undefined, undefined).key).toBe("unknown");
  });
  it("扩展名与默认名称来自文件名，不超过后端名称上限", () => {
    expect(materialExtension("合成模板.DOCX")).toBe("DOCX");
    expect(materialExtension(undefined)).toBe("FILE");
    expect(materialStem("合成要求.txt")).toBe("合成要求");
    expect(Array.from(materialStem("长".repeat(260) + ".md"))).toHaveLength(200);
  });
  it("任务按固定原件归属，缺少原件范围的任务不匹配", () => {
    expect(jobOriginalId({ resource_scope: { original_version_id: "o-1" } as never, input_snapshot: null })).toBe("o-1");
    expect(jobOriginalId({ resource_scope: null, input_snapshot: { original_version_id: "o-2" } as never })).toBe("o-2");
    expect(jobOriginalId({ resource_scope: null, input_snapshot: null })).toBeUndefined();
  });
});

describe("提取文本分片、高亮与模板格式项", () => {
  it("优先使用来源锚点并区分受保护的标记片段；无锚点时按行编号", () => {
    const fragments = materialFragments({
      plain_text: "",
      anchors: [
        { id: "a", kind: "paragraph", part: "word/document.xml", original_text: "第一段", editable: true },
        { id: "b", kind: "paragraph", part: "word/document.xml", original_text: "第二段" },
        { id: "c", kind: "section", part: "word/document.xml", original_text: "<w:sectPr/>", editable: false },
        { id: "d", kind: "paragraph", part: "word/document.xml", original_text: "  " },
      ],
    });
    expect(fragments.map((item) => item.label)).toEqual(["段落 1", "段落 2", "分节设置 1"]);
    expect(fragments[2]).toMatchObject({ editable: false, markup: true });
    expect(materialFragments({ plain_text: "甲\n\n乙", anchors: [] }).map((item) => [item.label, item.text])).toEqual([
      ["第 1 行", "甲"],
      ["第 3 行", "乙"],
    ]);
  });
  it("高亮不区分大小写并保留原文全部字符", () => {
    const parts = highlightParts("APA 格式与 apa 引用", "apa");
    expect(parts.filter((part) => part.match).map((part) => part.text)).toEqual(["APA", "apa"]);
    expect(parts.map((part) => part.text).join("")).toBe("APA 格式与 apa 引用");
    expect(highlightParts("原文", "  ")).toEqual([{ text: "原文", match: false }]);
  });
  it("模板值按单位换算，未识别不补造数值，范围只显示类型", () => {
    expect(templateValue({ value: 11906, unit: "twip" })).toBe("21.00 cm");
    expect(templateValue({ value: 24, unit: "half_point" })).toBe("12 磅");
    expect(templateValue({ value: 0, unit: "zero_based" })).toBe("第 1 级");
    expect(templateValue({ value: null, unit: "twip" })).toBe("—");
    expect(templateScope("section:abc-123")).toBe("分节设置");
    expect(templateScope("document")).toBe("全文");
  });
});

describe("项目来源绑定共享快照", () => {
  function stub(update: (input: unknown) => Promise<unknown>) {
    const updateSourceBinding = vi.fn(async (_project: string, input: unknown) => update(input));
    const services = {
      materials: {
        sourceBinding: vi.fn(async () => ({
          project_id: "p",
          version: 3,
          current_version_id: "v3",
          template_parse_version_id: null,
          requirement_parse_version_ids: ["r-1"],
          updated_at: null,
        })),
        updateSourceBinding,
        parse: vi.fn(),
      },
    } as unknown as BackendServices;
    const scope = effectScope();
    const state = scope.run(() => useSourceBinding(services, () => "p"))!;
    return { updateSourceBinding, state, scope };
  }
  it("绑定模板时携带读取时的版本与原有要求，不丢失要求集", async () => {
    const { updateSourceBinding, state, scope } = stub(async (input) => ({
      ...(input as object),
      project_id: "p",
      version: 4,
      current_version_id: "v4",
      updated_at: null,
    }));
    await state.load();
    await state.save({ template: "t-1" });
    expect(updateSourceBinding).toHaveBeenCalledWith(
      "p",
      { expected_version: 3, template_parse_version_id: "t-1", requirement_parse_version_ids: ["r-1"] },
      expect.anything(),
    );
    expect(state.binding.value?.version).toBe(4);
    scope.stop();
  });
  it("版本冲突后要求重新载入，阻止基于旧快照继续保存", async () => {
    const { updateSourceBinding, state, scope } = stub(async () => {
      throw new ApiError("MATERIAL_BINDING_CONFLICT", { status: 409 });
    });
    await state.load();
    expect(await state.save({ requirements: [] })).toBeUndefined();
    expect(state.mustReload.value).toBe(true);
    expect(state.error.value).toContain("载入最新绑定");
    await state.save({ template: "t-1" });
    expect(updateSourceBinding).toHaveBeenCalledTimes(1);
    await state.load();
    expect(state.mustReload.value).toBe(false);
    scope.stop();
  });
  it("超过 50 个要求版本在发送前拒绝", async () => {
    const { updateSourceBinding, state, scope } = stub(async (input) => input);
    await state.load();
    await state.save({ requirements: Array.from({ length: 51 }, (_, index) => `r-${index}`) });
    expect(updateSourceBinding).not.toHaveBeenCalled();
    expect(state.error.value).toContain("50");
    scope.stop();
  });
});
