import { describe, expect, it } from "vite-plus/test";
import { configChain, configHealth, type ConfigLike, type KnownVersion } from "../../src/workspace/configurations/configurationChain.ts";
import { moveStage } from "../../src/workspace/flows/stageOrder.ts";

const known = (kind: KnownVersion["config"]["kind"], id: string, name: string, enabled: boolean, content: Record<string, unknown>): KnownVersion => ({
  config: { kind, name, enabled },
  version: { id, version: 1, name, content: { kind, ...content } },
});
const api = known("api", "api-v1", "自制接口", true, {});
const model = known("model", "model-v1", "自制模型", true, { api_version_id: "api-v1" });
const prompt = known("prompt", "prompt-v1", "自制提示词", true, {});
const agent = (enabled = true): ConfigLike => ({
  name: "自制智能体",
  enabled,
  version: 2,
  content: { kind: "agent", model_version_id: "model-v1", prompt_version_id: "prompt-v1" },
});

describe("配置台关联链与阶段顺序", () => {
  it("智能体链按接口、模型、提示词、智能体排列，全部有效", () => {
    const chain = configChain(agent(), [api, model, prompt]);
    expect(chain.map((node) => node.lib)).toEqual(["api", "model", "prompt", "agent"]);
    expect(chain.every((node) => node.state === "active")).toBe(true);
    expect(configHealth(agent(), [api, model, prompt])).toBe("active");
  });

  it("上游停用使下游关联无效，且不自动换用其他配置", () => {
    const stopped = known("api", "api-v1", "自制接口", false, {});
    const chain = configChain(agent(), [stopped, model, prompt]);
    expect(chain.map((node) => node.state)).toEqual(["disabled", "invalid", "active", "invalid"]);
    expect(chain[1]!.problem).toContain("接口已停用");
    expect(configHealth(agent(), [stopped, model, prompt])).toBe("invalid");
  });

  it("自身停用显示为停用；引用缺失在读全后判为无效，未读全时不误判", () => {
    expect(configHealth(agent(false), [api, model, prompt])).toBe("disabled");
    expect(configHealth(agent(), [api, model])).toBe("invalid");
    expect(configChain(agent(), [api, model], true).find((node) => node.lib === "prompt")?.problem).toContain("不存在");
    expect(configHealth(agent(), [], false)).toBe("active");
  });

  it("接口与提示词没有上游，模型缺少接口版本时无效", () => {
    expect(configChain({ name: "接口", enabled: true, version: 1, content: { kind: "api" } }, [])).toHaveLength(1);
    const orphan: ConfigLike = { name: "模型", enabled: true, version: 1, content: { kind: "model", api_version_id: "" } };
    expect(configHealth(orphan, [])).toBe("invalid");
  });

  it("阶段上移下移只交换相邻项，越界不变且不修改原数组", () => {
    const stages = [{ id: "a" }, { id: "b" }, { id: "c" }];
    expect(moveStage(stages, 1, -1).map((item) => item.id)).toEqual(["b", "a", "c"]);
    expect(moveStage(stages, 1, 1).map((item) => item.id)).toEqual(["a", "c", "b"]);
    expect(moveStage(stages, 0, -1).map((item) => item.id)).toEqual(["a", "b", "c"]);
    expect(moveStage(stages, 2, 1).map((item) => item.id)).toEqual(["a", "b", "c"]);
    expect(stages.map((item) => item.id)).toEqual(["a", "b", "c"]);
  });
});
