import { describe, expect, it } from "vite-plus/test";
import {
  blankContent,
  canonical,
  configurationChanges,
  contentError,
  schemaValue,
  probeResultPresentation,
  shouldApplyTaskUpdate,
  variableValues,
} from "../../src/workspace/configurations/configurationEditor.ts";

describe("正式四库版本比较与显式试跑输入", () => {
  it("字段顺序变化不误报版本内容差异", () => {
    const first = { name: "自制配置", content: { model: "deepseek-flash", temperature: 0.2 } };
    const second = { content: { temperature: 0.2, model: "deepseek-flash" }, name: "自制配置" };
    expect(canonical(first)).toBe(canonical(second));
    expect(configurationChanges(first, second)).toEqual([]);
  });
  it("明确报告字段新增、删除与配置改变，保留原值", () => {
    const first = { prompt: "旧提示", timeout: 30 };
    const second = { prompt: "新提示", enabled: false };
    expect(configurationChanges(first, second)).toEqual([
      { key: "enabled", before: undefined, after: false },
      { key: "prompt", before: "旧提示", after: "新提示" },
      { key: "timeout", before: 30, after: undefined },
    ]);
    expect(first).toEqual({ prompt: "旧提示", timeout: 30 });
  });
  it("试跑只接收显式文本变量，不接受数组、嵌套对象和危险属性", () => {
    expect(variableValues('{"context":"合成背景","goal":"比较要求"}')).toEqual({ context: "合成背景", goal: "比较要求" });
    for (const input of ["[]", "null", "bad", '{"context":{}}', '{"__proto__":"x"}', '{"context":42}', '{"bad-name":"x"}'])
      expect(() => variableValues(input)).toThrow();
  });

  it("提示词占位符与声明一一对应，输入结构不得扩大变量范围", () => {
    const prompt = blankContent("prompt");
    if (prompt.kind !== "prompt") throw new Error("unexpected kind");
    expect(contentError(prompt)).toBe("");
    expect(contentError({ ...prompt, template: "{{context}}" })).toContain("一一对应");
    expect(contentError({ ...prompt, template: "{{context" })).toContain("不完整");
    expect(contentError({ ...prompt, template: "{{unknown}}" })).toContain("一一对应");
    expect(contentError({ ...prompt, input_schema: { materials: "string" } })).toContain("已声明");
  });

  it("结构校验拒绝复杂JSON Schema与危险字段，只接受明确类型映射", () => {
    expect(schemaValue('{"suggestion":"string","count":"number"}')).toEqual({ suggestion: "string", count: "number" });
    for (const input of ["[]", "null", '{"type":"text"}', '{"data":{"type":"string"}}', '{"__proto__":"string"}']) expect(() => schemaValue(input)).toThrow();
  });

  it("模型必须明确关联接口，参数采用有限范围而非隐式转换", () => {
    const model = blankContent("model");
    if (model.kind !== "model") throw new Error("unexpected kind");
    expect(contentError(model)).toContain("接口版本");
    const valid = { ...model, api_version_id: "version-id" };
    expect(contentError(valid)).toBe("");
    expect(contentError({ ...valid, temperature: Number.NaN })).toContain("温度");
    expect(contentError({ ...valid, max_output_tokens: 8193 })).toContain("输出上限");
    expect(contentError({ ...valid, context_limit: 128 })).toContain("上下文");
    const api = blankContent("api");
    if (api.kind !== "api") throw new Error("unexpected kind");
    expect(api.credential_ref).toBe("deepseek-default");
    expect(api.max_retries).toBe(2);
    expect(contentError({ ...api, max_retries: 4 })).toContain("重试");
  });
  it("服务端已确认取消后，迟到轮询不得把任务恢复为运行中", () => {
    const cancelled = { id: "job-1", status: "cancelled", updated_at: "2026-11-17T15:00:02Z" };
    expect(shouldApplyTaskUpdate(cancelled, { ...cancelled, status: "running", updated_at: "2026-11-17T15:00:01Z" })).toBe(false);
    expect(shouldApplyTaskUpdate(cancelled, { ...cancelled, status: "queued", updated_at: "2026-11-17T15:00:03Z" })).toBe(false);
    expect(shouldApplyTaskUpdate(cancelled, { id: "retry-2", status: "queued", updated_at: "2026-11-17T15:00:03Z" })).toBe(true);
  });
  it("试跑默认展示可读内容和真实模型来源，协议字段留给运行详情", () => {
    const protocol = {
      kind: "configuration_probe",
      schema_version: 1,
      job_id: "private-job-id",
      config_kind: "model",
      config_version_id: "12345678-abcd-0000-0000-000000000000",
      content: "建议先明确研究问题。",
      model_used: true,
      requested_model: "deepseek-flash",
      response_model: "deepseek-flash-actual",
      writes_performed: false,
    };
    expect(probeResultPresentation(protocol)).toEqual({
      content: "建议先明确研究问题。",
      execution: "真实模型调用",
      requestedModel: "deepseek-flash",
      responseModel: "deepseek-flash-actual",
      versionShort: "12345678",
    });
    expect(probeResultPresentation({ ...protocol, model_used: false, config_kind: "prompt", requested_model: null, response_model: null })).toMatchObject({
      execution: "提示词渲染（未调用模型）",
      requestedModel: undefined,
      responseModel: undefined,
    });
    expect(probeResultPresentation(null)).toBeUndefined();
    expect(probeResultPresentation({ kind: "diagnostic", content: "诊断" })).toBeUndefined();
  });
});
