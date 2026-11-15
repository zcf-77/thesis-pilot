import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { expect } from "@playwright/test";

// Run from apps/web. The key and authenticated storage stay in memory only.
// TP_COMPETITION_PROBE=1 checks recording without opening an application service.
const probe = process.env.TP_COMPETITION_PROBE === "1";
const scenarioIds = ["01-writing-history", "02-structure-task", "03-conflict-recovery", "04-configurations", "05-materials"];
const requestedScenarios = process.env.TP_COMPETITION_SCENARIOS;
const selectedScenarios =
  requestedScenarios === undefined
    ? scenarioIds
    : [
        ...new Set(
          requestedScenarios
            .split(",")
            .map((id) => id.trim())
            .filter(Boolean),
        ),
      ];
if (!probe && (!selectedScenarios.length || selectedScenarios.some((id) => !scenarioIds.includes(id)))) {
  throw new Error(`TP_COMPETITION_SCENARIOS must select from: ${scenarioIds.join(", ")}`);
}
const origin = process.env.TP_COMPETITION_ORIGIN ?? process.env.TP_WORKSPACE_TEST_ORIGIN;
const accessKey = process.env.TP_COMPETITION_ACCESS_KEY ?? process.env.TP_WORKSPACE_TEST_ACCESS_KEY;
if (!probe && (!origin || !/^http:\/\/127\.0\.0\.1:\d+$/.test(origin))) throw new Error("请设置本机专用 TP_COMPETITION_ORIGIN。");
if (!probe && !accessKey) throw new Error("请通过进程环境提供 TP_COMPETITION_ACCESS_KEY。");
const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const runId = new Date().toISOString().replace(/[:.]/g, "-");
const out = resolve(process.env.TP_COMPETITION_OUT ?? resolve(root, "work/competition-evidence", runId));
const viewport = { width: 1920, height: 1080 };
const holdMs = Number(process.env.TP_COMPETITION_HOLD_MS ?? 1400);
const jobTimeout = Number(process.env.TP_COMPETITION_JOB_TIMEOUT_MS ?? 45000);
if (!Number.isFinite(holdMs) || holdMs < 0 || holdMs > 10000 || !Number.isFinite(jobTimeout) || jobTimeout < 1000 || jobTimeout > 180000) {
  throw new Error("录屏停留时间或任务等待时间超出允许范围。");
}
const redact = (value) => {
  const message = String(value instanceof Error ? value.message : value);
  return accessKey ? message.replaceAll(accessKey, "[访问口令已隐藏]") : message;
};
await mkdir(out, { recursive: true });
const manifest = {
  runId,
  origin: probe ? null : origin,
  viewport,
  syntheticData: true,
  loginRecorded: false,
  format: "WebM",
  selectedScenarios: probe ? ["recording-probe"] : selectedScenarios,
  scenarios: [],
};
const browser = await chromium.launch({
  channel: process.env.PLAYWRIGHT_CHANNEL ?? "chrome",
  headless: process.env.TP_COMPETITION_HEADED !== "1",
  // Software canvas capture avoids empty MediaRecorder output on this Windows GPU.
  args: ["--disable-gpu", "--disable-frame-rate-limit"],
});
let storageState;

async function mediaRecorder(target, output) {
  const encoding = await browser.newContext({ viewport, deviceScaleFactor: 1 });
  const encoder = await encoding.newPage();
  await encoder.evaluate(({ width, height }) => {
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    document.body.append(canvas);
    const painter = canvas.getContext("2d", { alpha: false });
    if (!painter) throw new Error("录屏画布不可用。");
    const mimeType = "video/webm;codecs=vp8";
    if (!MediaRecorder.isTypeSupported(mimeType)) throw new Error("浏览器不支持 VP8 WebM。");
    const stream = canvas.captureStream(0);
    const track = stream.getVideoTracks()[0];
    const recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 5000000 });
    const chunks = [];
    let latest;
    recorder.ondataavailable = ({ data }) => {
      if (data.size) chunks.push(data);
    };
    const timer = setInterval(() => {
      if (latest) {
        painter.drawImage(latest, 0, 0, width, height);
        track.requestFrame();
      }
    }, 50);
    recorder.start(250);
    globalThis.competitionEncoder = {
      async draw(jpeg) {
        const bytes = Uint8Array.from(atob(jpeg), (char) => char.charCodeAt(0));
        const bitmap = await createImageBitmap(new Blob([bytes], { type: "image/jpeg" }));
        latest?.close();
        latest = bitmap;
        painter.drawImage(bitmap, 0, 0, width, height);
        track.requestFrame();
      },
      async finish() {
        await new Promise((done, reject) => {
          recorder.addEventListener("stop", done, { once: true });
          recorder.addEventListener("error", () => reject(new Error("录屏编码失败。")), { once: true });
          recorder.stop();
        });
        clearInterval(timer);
        stream.getTracks().forEach((track) => track.stop());
        latest?.close();
        return await new Promise((done, reject) => {
          const reader = new FileReader();
          reader.onload = () => {
            if (typeof reader.result === "string") done(reader.result.split(",")[1]);
            else reject(new Error("录屏导出数据格式无效。"));
          };
          reader.onerror = () => reject(new Error("录屏导出失败。"));
          reader.readAsDataURL(new Blob(chunks, { type: mimeType }));
        });
      },
    };
  }, viewport);
  const session = await target.context().newCDPSession(target);
  let accepting = true;
  let busy = false;
  let lastFrame = 0;
  let encodedFrames = 0;
  let receivedFrames = 0;
  let pending = Promise.resolve();
  const errors = [];
  session.on("Page.screencastFrame", (frame) => {
    void session.send("Page.screencastFrameAck", { sessionId: frame.sessionId }).catch((error) => {
      if (accepting) errors.push(redact(error));
    });
    receivedFrames++;
    if (!accepting || busy || Date.now() - lastFrame < 50) return;
    busy = true;
    lastFrame = Date.now();
    pending = encoder
      .evaluate((jpeg) => globalThis.competitionEncoder.draw(jpeg), frame.data)
      .then(() => {
        encodedFrames++;
      })
      .catch((error) => errors.push(redact(error)))
      .finally(() => {
        busy = false;
      });
  });
  await target.bringToFront();
  await session.send("Page.startScreencast", { format: "jpeg", quality: 90, maxWidth: viewport.width, maxHeight: viewport.height, everyNthFrame: 1 });
  return async () => {
    accepting = false;
    try {
      await session.send("Page.stopScreencast");
      await pending;
      assert.ok(encodedFrames > 0, "录屏没有真实页面帧。");
      assert.deepEqual(errors, [], "真实帧录制失败。");
      const base64 = await encoder.evaluate(() => globalThis.competitionEncoder.finish());
      await writeFile(output, Buffer.from(base64, "base64"));
      return { method: "Chrome CDP screencast + MediaRecorder", receivedFrames, encodedFrames, targetFps: 20 };
    } finally {
      await session.detach().catch(() => {});
      await encoding.close();
    }
  };
}

async function verifyVideo(file) {
  const bytes = await readFile(file);
  const verifier = await browser.newContext();
  try {
    const page = await verifier.newPage();
    const metadata = await page.evaluate(async (base64) => {
      const video = document.createElement("video");
      video.muted = true;
      video.src = "data:video/webm;base64," + base64;
      await new Promise((done, reject) => {
        const timeout = setTimeout(() => reject(new Error("视频加载超时。")), 15000);
        video.onloadeddata = () => {
          clearTimeout(timeout);
          done();
        };
        video.onerror = () => {
          clearTimeout(timeout);
          reject(new Error("视频无法解码。"));
        };
      });
      await video.play();
      await new Promise((done, reject) => {
        const timeout = setTimeout(() => reject(new Error("视频无法推进播放。")), 10000);
        video.ontimeupdate = () => {
          if (video.currentTime > 0.1) {
            clearTimeout(timeout);
            done();
          }
        };
      });
      video.pause();
      const playbackVerified = video.currentTime > 0.1;
      // MediaRecorder WebM may omit the duration header. Seek through the real
      // stream so Chrome resolves its last timestamp instead of guessing time.
      if (!Number.isFinite(video.duration)) {
        await new Promise((done, reject) => {
          const timeout = setTimeout(() => reject(new Error("视频尾部时间戳解析超时。")), 15000);
          video.onseeked = () => {
            clearTimeout(timeout);
            done();
          };
          video.currentTime = 1e10;
        });
      }
      const duration = video.duration;
      if (!Number.isFinite(duration) || duration <= 0) throw new Error("视频没有可核验的有限时长。");
      return { width: video.videoWidth, height: video.videoHeight, durationSeconds: duration, playbackVerified, tailTimestampVerified: true };
    }, bytes.toString("base64"));
    assert.equal(metadata.width, viewport.width);
    assert.equal(metadata.height, viewport.height);
    return { ...metadata, bytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") };
  } finally {
    await verifier.close();
  }
}

async function scenario(id, title, action) {
  if (!probe && !selectedScenarios.includes(id)) return;
  const entry = { id, title, video: resolve(out, id + ".webm"), status: "running", steps: [], errors: [] };
  manifest.scenarios.push(entry);
  const started = Date.now();
  let context;
  let page;
  let stop;
  let nativeVideo;
  try {
    try {
      context = await browser.newContext({
        baseURL: origin,
        viewport,
        deviceScaleFactor: 1,
        storageState,
        recordVideo: { dir: resolve(out, "raw", id), size: viewport },
      });
      page = await context.newPage();
      nativeVideo = page.video();
      entry.recording = { method: "Playwright recordVideo" };
    } catch (error) {
      if (!/ffmpeg/i.test(String(error))) throw error;
      await context?.close();
      entry.recordingFallback = "Playwright FFmpeg 不可用，使用浏览器实际帧编码。";
      context = await browser.newContext({ baseURL: origin, viewport, deviceScaleFactor: 1, storageState });
      page = await context.newPage();
      stop = await mediaRecorder(page, entry.video);
    }
    context.setDefaultTimeout(15000);
    page.on("pageerror", (error) => entry.errors.push(redact(error)));
    const step = async (label, delay = holdMs) => {
      entry.steps.push({ label, elapsedMilliseconds: Date.now() - started });
      if (delay) await page.waitForTimeout(delay);
    };
    await action({ page, context, entry, step });
    assert.deepEqual(entry.errors, [], "页面出现未处理异常。");
    entry.status = entry.status === "partial" ? "partial" : "passed";
  } catch (error) {
    entry.status = "failed";
    entry.failure = redact(error);
    if (page && !page.isClosed()) await page.screenshot({ path: resolve(out, id + "-failure.png") }).catch(() => {});
  } finally {
    if (stop) {
      try {
        entry.recording = await stop();
      } catch (error) {
        entry.status = "failed";
        entry.recordingFailure = redact(error);
      }
    }
    await context?.close();
    if (nativeVideo) {
      try {
        await nativeVideo.saveAs(entry.video);
      } catch (error) {
        entry.status = "failed";
        entry.recordingFailure = redact(error);
      }
    }
    try {
      entry.metadata = await verifyVideo(entry.video);
    } catch (error) {
      entry.status = "failed";
      entry.playbackFailure = redact(error);
    }
    entry.elapsedMilliseconds = Date.now() - started;
    await writeFile(resolve(out, "manifest.json"), JSON.stringify(manifest, null, 2));
    console.log(JSON.stringify({ scenario: id, status: entry.status, video: entry.video, metadata: entry.metadata }));
  }
}

const editor = (page) => page.locator('[aria-label="论文正文编辑区"][contenteditable="true"]');
async function newManuscript(page, step, label) {
  await page.goto("/#/projects");
  await expect(page.getByRole("heading", { name: "论文项目" })).toBeVisible();
  await step("进入正式项目目录");
  await page.getByRole("button", { name: "新建项目", exact: true }).click();
  await page.getByLabel("项目名称", { exact: true }).fill(`合成演示 · ${label} · ${runId}`);
  await step("输入独立合成项目名称");
  await page.getByRole("button", { name: "创建项目", exact: true }).click();
  await expect(page).toHaveURL(/#\/projects\/[a-f0-9-]+\/write$/);
  const writingUrl = page.url();
  const projectId = writingUrl.match(/\/projects\/([a-f0-9-]+)\/write$/)[1];
  await page.getByRole("button", { name: "创建空白正式稿", exact: true }).click();
  await expect(editor(page)).toBeVisible();
  await step("创建空白正式稿 v1");
  return { projectId, writingUrl };
}
async function save(page, projectId, expectedStatus = 200) {
  const reply = page.waitForResponse((response) => response.request().method() === "PATCH" && response.url().includes(`/projects/${projectId}/documents/`));
  await page.getByRole("button", { name: "保存", exact: true }).click();
  const response = await reply;
  assert.equal(response.status(), expectedStatus);
  return expectedStatus === 200 ? await response.json() : null;
}

try {
  if (probe) {
    await scenario("recording-probe", "录屏工具检查，不是业务演示", async ({ page, step }) => {
      await page.setContent(
        '<!doctype html><meta charset="utf-8"><title>录屏工具检查</title><body style="background:#faf7f0;color:#342b26;font:48px sans-serif;padding:100px"><h1>ThesisPilot 录屏工具检查</h1><p>此片段仅验证 1920 × 1080 真实帧录制与播放。</p><button style="font:inherit;padding:24px">检查真实鼠标操作</button></body>',
      );
      await step("显示工具检查页", 1000);
      await page.getByRole("button").click();
      await step("执行实际按钮点击", 1000);
    });
  } else {
    const login = await browser.newContext({ baseURL: origin, viewport });
    try {
      const page = await login.newPage();
      await page.goto("/");
      await page.getByLabel("工作区访问口令", { exact: true }).fill(accessKey);
      const established = page.waitForResponse(
        (response) => response.request().method() === "POST" && new URL(response.url()).pathname === "/api/v1/workspace/session",
      );
      await page.getByRole("button", { name: "解锁工作区", exact: true }).click();
      assert.equal((await established).status(), 200, "正式会话建立失败。");
      await page.goto("/#/projects");
      await expect(page.getByRole("heading", { name: "论文项目", exact: true })).toBeVisible({ timeout: 15000 });
      const checked = await login.request.get("/api/v1/workspace/session");
      assert.equal(checked.status(), 200, "录制前服务端会话复查失败。");
      storageState = await login.storageState();
      assert.ok(
        storageState.cookies.some((cookie) => cookie.name === "tp_workspace_session" && cookie.httpOnly),
        "录制前缺少正式 HttpOnly 会话。",
      );
      manifest.authentication = { loginHttpStatus: 200, sessionHttpStatus: 200, projectsLoaded: true, httpOnlyCookiePresent: true };
    } finally {
      await login.close();
    }

    await scenario("01-writing-history", "创建项目、保存、历史与刷新", async ({ page, entry, step }) => {
      const { projectId, writingUrl } = await newManuscript(page, step, "正文与历史");
      entry.projectId = projectId;
      const text = "这是自制的校园图书检索系统演示文稿。\n系统按关键词返回书目，并保留操作记录。所有内容仅用于功能演示。";
      await editor(page).fill(text);
      await step("在正文中输入自制文稿");
      const document = await save(page, projectId);
      assert.equal(document.version, 2);
      await step("显式保存为正式稿 v2");
      await page.getByRole("button", { name: "版本历史", exact: true }).click();
      await expect(page.getByRole("complementary", { name: "版本历史", exact: true })).toBeVisible();
      await step("展开真实版本历史");
      await page.goto(`/#/projects/${projectId}/documents/${document.id}/versions/1?source=http%3Aworkspace`);
      await expect(page.getByRole("region", { name: "正式稿版本对比" })).toBeVisible();
      await step("查看不可变 v1 与当前正文对比");
      await page.goto(writingUrl);
      await page.reload();
      await expect(editor(page)).toContainText("校园图书检索系统");
      await step("刷新后从服务端恢复已保存正文", holdMs * 2);
      await page.screenshot({ path: resolve(out, "01-writing-history.png") });
    });

    await scenario("02-structure-task", "固定正文版本的真实结构任务", async ({ page, entry, step }) => {
      const { projectId } = await newManuscript(page, step, "结构任务");
      entry.projectId = projectId;
      const savedText = "合成结构检查🙂";
      await editor(page).fill(savedText);
      await save(page, projectId);
      await step("保存用于检查的正式稿 v2");
      await editor(page).fill("这是尚未保存的后续草稿，不应进入 v2 的检查统计。");
      await expect(page.getByText("草稿已保留", { exact: true })).toBeVisible();
      const accepted = page.waitForResponse((response) => response.request().method() === "POST" && response.url().endsWith("/api/v1/jobs"));
      await page.getByRole("button", { name: "检查正文结构", exact: true }).click();
      const response = await accepted;
      assert.equal(response.status(), 202);
      const job = await response.json();
      entry.jobId = job.id;
      assert.equal(job.resource_scope.document_version, 2);
      await step("提交固定 v2 的检查，当前草稿保持原样");
      await page.getByRole("link", { name: "查看正式稿 v2 的结构检查", exact: true }).click();
      const detail = page.getByRole("complementary", { name: "任务详情", exact: true });
      const result = detail.getByTestId("inspection-result");
      try {
        await expect(result).toBeVisible({ timeout: jobTimeout });
      } catch {
        const latest = await page.request.get(`/api/v1/jobs/${job.id}?project_id=${projectId}`);
        assert.equal(latest.status(), 200);
        const latestJob = await latest.json();
        entry.jobStatus = latestJob.status;
        if (["failed", "cancelled", "succeeded"].includes(latestJob.status)) {
          throw new Error(`任务状态为 ${latestJob.status}，但结果未显示；本场景未通过。`);
        }
        entry.status = "partial";
        entry.limitation = "真实任务已提交，但在本次等待时间内未产生可见结果；不计作 worker 成功验收。";
        await step("保留实际任务状态，结果尚未完成");
        await page.screenshot({ path: resolve(out, "02-structure-task-pending.png") });
        return;
      }
      const stored = await page.request.get(`/api/v1/jobs/${job.id}?project_id=${projectId}`);
      assert.equal(stored.status(), 200);
      const record = await stored.json();
      assert.equal(record.status, "succeeded");
      assert.equal(record.artifacts[0].result.document_version, 2);
      assert.equal(record.artifacts[0].result.text_characters, Array.from(savedText).length);
      entry.result = { documentVersion: 2, textCharacters: record.artifacts[0].result.text_characters };
      await step("真实 worker 结果明确绑定 v2");
      await page.reload();
      await expect(result).toBeVisible();
      await step("刷新后恢复同一任务结果", holdMs * 2);
      await page.screenshot({ path: resolve(out, "02-structure-task.png") });
    });

    await scenario("03-conflict-recovery", "双窗口真实冲突与草稿恢复", async ({ page, entry, step }) => {
      const { projectId, writingUrl } = await newManuscript(page, step, "冲突恢复");
      entry.projectId = projectId;
      await editor(page).fill("两个窗口共同读取的自制基础版本。");
      await save(page, projectId);
      const second = await browser.newContext({ baseURL: origin, viewport, storageState });
      try {
        const other = await second.newPage();
        await other.goto(writingUrl);
        await expect(editor(other)).toHaveText("两个窗口共同读取的自制基础版本。");
        const local = "窗口甲尚未提交的自制草稿，冲突后必须保留。";
        const remote = "窗口乙先保存的自制新版本。";
        await editor(page).fill(local);
        await expect(page.getByText("草稿已保留", { exact: true })).toBeVisible();
        await step("窗口甲在 v2 上编辑并保留本机草稿");
        await editor(other).fill(remote);
        const document = await save(other, projectId);
        assert.equal(document.version, 3);
        await page.bringToFront();
        await save(page, projectId, 409);
        await expect(editor(page)).toHaveText(local);
        await step("窗口乙先保存 v3；窗口甲提交得到真实 409，原输入保留", holdMs * 2);
        await page.getByRole("button", { name: "检查最新版本", exact: true }).click();
        await expect(page.getByRole("button", { name: "保留草稿并载入新版", exact: true })).toBeVisible();
        await page.getByRole("button", { name: "保留草稿并载入新版", exact: true }).click();
        await expect(editor(page)).toHaveText(remote);
        await step("显式保留冲突草稿并载入服务端 v3");
        await page.getByRole("button", { name: /^草稿（/ }).click();
        await expect(page.getByRole("region", { name: "保留的正式稿草稿", exact: true })).toBeVisible();
        await step("查看仍保留的 v2 草稿");
        await page.getByRole("region", { name: "保留的正式稿草稿", exact: true }).getByRole("button", { name: "载入草稿", exact: true }).first().click();
        await expect(editor(page)).toHaveText(local);
        await page.reload();
        await expect(editor(page)).toHaveText(local);
        await step("载入草稿后刷新，未提交内容仍完整保留", holdMs * 2);
        await page.screenshot({ path: resolve(out, "03-conflict-recovery.png") });
      } finally {
        await second.close();
      }
    });

    await scenario("04-configurations", "四库固定版本、引用与确定性提示词试跑", async ({ page, entry, step }) => {
      const projectName = `合成四库录屏 ${runId}`;
      await page.goto("/#/projects");
      await expect(page.getByRole("heading", { name: "论文项目", exact: true })).toBeVisible();
      await page.getByRole("button", { name: "新建项目", exact: true }).click();
      await page.getByLabel("项目名称", { exact: true }).fill(projectName);
      await page.getByRole("button", { name: "创建项目", exact: true }).click();
      await expect(page).toHaveURL(/\/projects\/[a-f0-9-]+\/write$/);
      const projectId = page.url().match(/\/projects\/([a-f0-9-]+)\/write$/)[1];
      entry.projectId = projectId;
      await step("创建合成试跑项目，保留正式稿为空");
      await page.goto("/#/configurations");
      await expect(page.getByRole("heading", { name: "AI 配置", exact: true })).toBeVisible();
      const form = page.getByRole("region", { name: "配置编辑", exact: true });
      const created = {};
      const choose = async (scope, label, value) => {
        await scope.getByRole("combobox", { name: label, exact: true }).click();
        await page.getByRole("option", { name: value, exact: true }).click();
      };
      const create = async (kind, name) => {
        await form.getByLabel("配置名称").fill(name);
        await step(`录入${kind}配置与明确版本引用`);
        const submitted = page.waitForResponse(
          (response) => response.request().method() === "POST" && new URL(response.url()).pathname === "/api/v1/ai-configs",
        );
        await form.getByRole("button", { name: "创建配置", exact: true }).click();
        const response = await submitted;
        assert.equal(response.status(), 201);
        created[kind] = await response.json();
        await expect(form).toHaveCount(0);
        await step(`${kind}配置已持久保存为 v1`);
      };
      await page.getByRole("button", { name: "新增AI 接口", exact: true }).click();
      await create("api", `合成接口 ${runId}`);
      await page.getByRole("tab", { name: "模型", exact: true }).click();
      await page.getByRole("button", { name: "新增模型", exact: true }).click();
      await choose(form, "接口版本", `${created.api.name} · v1`);
      await create("model", `合成模型 ${runId}`);
      await page.getByRole("tab", { name: "提示词", exact: true }).click();
      await page.getByRole("button", { name: "新增提示词", exact: true }).click();
      await form.getByLabel("提示词模板").fill("合成确定性试跑：{{context}}");
      await form.getByRole("checkbox", { name: "context · 背景", exact: true }).check();
      await form.getByRole("checkbox", { name: "goal · 目标", exact: true }).uncheck();
      await create("prompt", `合成提示词 ${runId}`);
      await page.getByRole("tab", { name: "智能体", exact: true }).click();
      await page.getByRole("button", { name: "新增智能体", exact: true }).click();
      await choose(form, "模型版本", `${created.model.name} · v1`);
      await choose(form, "提示词版本", `${created.prompt.name} · v1`);
      await form.getByLabel("智能体职责").fill("仅检查当前显式提供的合成文本，返回建议，不改正式稿。");
      await create("agent", `合成智能体 ${runId}`);
      await page.getByRole("tab", { name: "提示词", exact: true }).click();
      await page.getByRole("button", { name: created.prompt.name, exact: true }).click();
      const detail = page.getByRole("region", { name: "配置详情", exact: true });
      await expect(detail.getByRole("heading", { name: "v1 内容（只读）", exact: true })).toBeVisible();
      await choose(detail, "查看配置版本", `v1 · ${created.prompt.name}`);
      const references = detail.getByRole("region", { name: "关联使用", exact: true });
      await references.scrollIntoViewIfNeeded();
      await expect(references).toContainText(created.agent.name);
      await step("查看提示词不可变 v1，确认智能体引用该版本", holdMs * 2);
      const referenceResponse = await page.request.get(`/api/v1/ai-configs/${created.prompt.id}/references`);
      assert.equal(referenceResponse.status(), 200);
      assert.ok((await referenceResponse.json()).configs.some((item) => item.config_id === created.agent.id));
      const trial = page.getByRole("region", { name: "配置试跑", exact: true });
      await trial.scrollIntoViewIfNeeded();
      await choose(trial, "试跑项目", projectName);
      const syntheticText = "数字42仅为自制示例；本次只渲染模板，不调用模型。";
      await trial.getByLabel("试跑变量 JSON", { exact: true }).fill(JSON.stringify({ context: syntheticText }));
      await step("明确合成输入；提示词试跑为确定性模板渲染");
      const submitted = page.waitForResponse((response) => response.request().method() === "POST" && new URL(response.url()).pathname === "/api/v1/jobs");
      await trial.getByRole("button", { name: "发起配置试跑", exact: true }).click();
      const receipt = await submitted;
      assert.equal(receipt.status(), 202);
      const jobId = (await receipt.json()).id;
      entry.jobId = jobId;
      await step("任务固定提示词版本与输入，交给真实 worker 执行");
      await expect
        .poll(
          async () => {
            const response = await page.request.get(`/api/v1/jobs/${jobId}?project_id=${projectId}`);
            assert.equal(response.status(), 200);
            return (await response.json()).status;
          },
          { timeout: jobTimeout },
        )
        .toBe("succeeded");
      await trial.getByRole("button", { name: "刷新试跑状态", exact: true }).click();
      const resultRegion = trial.getByRole("region", { name: "试跑任务结果", exact: true });
      await expect(resultRegion).toContainText(syntheticText);
      await resultRegion.scrollIntoViewIfNeeded();
      const resultResponse = await page.request.get(`/api/v1/jobs/${jobId}?project_id=${projectId}`);
      assert.equal(resultResponse.status(), 200);
      const record = await resultResponse.json();
      const result = record.artifacts[0].result;
      assert.equal(result.model_used, false);
      assert.equal(result.writes_performed, false);
      assert.equal(result.config_kind, "prompt");
      assert.equal(result.config_version_id, created.prompt.current_version_id);
      assert.equal((await page.request.get(`/api/v1/projects/${projectId}/documents/current`)).status(), 404);
      entry.result = { configKind: result.config_kind, configVersionId: result.config_version_id, modelUsed: false, writesPerformed: false };
      entry.configIds = Object.fromEntries(Object.entries(created).map(([kind, config]) => [kind, config.id]));
      await step("实际任务成功；结果声明未调用模型、未写正文", holdMs * 2);
      await page.screenshot({ path: resolve(out, "04-configurations.png") });
      await page.reload();
      await page.getByRole("tab", { name: "提示词", exact: true }).click();
      await expect(page.getByRole("button", { name: created.prompt.name, exact: true })).toBeVisible();
      await step("刷新后四库记录仍由服务端恢复");
    });

    await scenario("05-materials", "合成DOCX原件、真实解析与受保护来源", async ({ page, entry, step }) => {
      const fixturePath = resolve(root, "work/competition-evidence/material-fixtures/synthetic-manuscript.docx");
      const fixture = await readFile(fixturePath);
      const sha256 = createHash("sha256").update(fixture).digest("hex");
      const projectName = `合成资料录屏 ${runId}`;
      const materialName = `合成DOCX资料 ${runId}`;
      await page.goto("/#/projects");
      await expect(page.getByRole("heading", { name: "论文项目", exact: true })).toBeVisible();
      await page.getByRole("button", { name: "新建项目", exact: true }).click();
      await page.getByLabel("项目名称").fill(projectName);
      await page.getByRole("button", { name: "创建项目", exact: true }).click();
      await expect(page).toHaveURL(/\/projects\/[a-f0-9-]+\/write$/);
      const projectId = page.url().match(/\/projects\/([a-f0-9-]+)\/write$/)[1];
      entry.projectId = projectId;
      await step("创建合成项目，资料解析不创建或改写正式稿");
      await page.getByRole("link", { name: "资料", exact: true }).click();
      await expect(page.getByRole("heading", { name: "项目资料", level: 1, exact: true })).toBeVisible();
      await page.getByRole("button", { name: "上传资料", exact: true }).click();
      const form = page.getByRole("region", { name: "上传资料", exact: true });
      await form.getByLabel("资料文件", { exact: true }).setInputFiles(fixturePath);
      await form.getByLabel("资料名称").fill(materialName);
      await form.getByRole("combobox", { name: "资料分类", exact: true }).click();
      await page.getByRole("option", { name: "其他资料", exact: true }).click();
      await form.getByLabel("资料来源").fill("自动生成的校园图书检索系统合成稿，含原生公式，不含真实论文。");
      await step("选择自制DOCX，填写资料分类与来源");
      const materialRoot = `/api/v1/projects/${projectId}/materials`;
      const accepted = page.waitForResponse((response) => response.request().method() === "POST" && new URL(response.url()).pathname === materialRoot);
      await form.getByRole("button", { name: "上传并解析", exact: true }).click();
      const response = await accepted;
      assert.equal(response.status(), 201);
      const receipt = await response.json();
      assert.equal(receipt.original.sha256, sha256);
      assert.equal(receipt.original.byte_size, fixture.length);
      assert.equal(receipt.job.kind, "material_parse");
      assert.ok(!Object.hasOwn(receipt.original, "data") && !Object.hasOwn(receipt.original, "content_base64"));
      entry.materialId = receipt.material.id;
      entry.originalId = receipt.original.id;
      entry.jobId = receipt.job.id;
      await expect(form).toHaveCount(0);
      await step("原件已不可变保存，真实解析任务自动入队");
      await expect
        .poll(
          async () => {
            const result = await page.request.get(`/api/v1/jobs/${receipt.job.id}?project_id=${projectId}`);
            assert.equal(result.status(), 200);
            return (await result.json()).status;
          },
          { timeout: jobTimeout },
        )
        .toBe("succeeded");
      const completed = await page.request.get(`/api/v1/jobs/${receipt.job.id}?project_id=${projectId}`);
      assert.equal(completed.status(), 200);
      const job = await completed.json();
      const summary = job.artifacts[0].result;
      assert.equal(summary.original_version_id, receipt.original.id);
      assert.equal(summary.model_used, false);
      assert.equal(summary.writes_performed, false);
      const parseResponse = await page.request.get(
        `${materialRoot}/${receipt.material.id}/originals/${receipt.original.id}/parses/${summary.parse_version_id}`,
      );
      assert.equal(parseResponse.status(), 200);
      const parsed = await parseResponse.json();
      assert.equal(parsed.result.status, "partial");
      assert.ok(parsed.result.anchors.some((anchor) => !anchor.editable && anchor.original_text.includes("x=1")));
      await page.reload();
      await page.getByRole("button", { name: materialName, exact: true }).click();
      const result = page.getByRole("region", { name: "解析结果", exact: true });
      const text = result.getByRole("region", { name: "提取文本", exact: true });
      await expect(text).toContainText("第一章 绪论");
      await text.scrollIntoViewIfNeeded();
      await step("查看真实解析文本与部分识别结果", holdMs * 2);
      const diagnostics = result.getByRole("region", { name: "解析诊断", exact: true });
      await diagnostics.scrollIntoViewIfNeeded();
      await expect(diagnostics).toContainText("受保护投影");
      await step("公式与未知结构保留原包，明确显示保护与支持限制", holdMs * 2);
      const sources = result.getByRole("region", { name: "来源锚点", exact: true });
      const formula = sources.locator(".material-source-anchor").filter({ hasText: "x=1" }).first();
      await formula.scrollIntoViewIfNeeded();
      await expect(formula).toContainText("受保护或只读来源");
      await step("定位原生公式来源与只读映射", holdMs * 2);
      await page.screenshot({ path: resolve(out, "05-materials-source.png") });
      const downloadButton = page.getByRole("button", { name: "下载当前原件", exact: true });
      await downloadButton.scrollIntoViewIfNeeded();
      const downloading = page.waitForEvent("download");
      await downloadButton.click();
      const download = await downloading;
      const downloadPath = resolve(out, "05-original-synthetic-manuscript.docx");
      await download.saveAs(downloadPath);
      const downloaded = await readFile(downloadPath);
      assert.deepEqual(downloaded, fixture);
      assert.equal(createHash("sha256").update(downloaded).digest("hex"), sha256);
      entry.originalDownload = { filename: download.suggestedFilename(), path: downloadPath, bytes: downloaded.length, sha256, matchesFixture: true };
      await step("实际下载原件，字节与SHA-256均与上传文件一致", holdMs * 2);
      await page.reload();
      await page.getByRole("button", { name: materialName, exact: true }).click();
      await expect(result).toContainText("第一章 绪论");
      await expect(page.getByRole("region", { name: "资料详情", exact: true })).toContainText(sha256);
      assert.equal((await page.request.get(`/api/v1/projects/${projectId}/documents/current`)).status(), 404);
      entry.result = {
        parseVersionId: summary.parse_version_id,
        status: parsed.result.status,
        anchorCount: parsed.result.anchors.length,
        modelUsed: false,
        writesPerformed: false,
      };
      await diagnostics.scrollIntoViewIfNeeded();
      await step("刷新恢复同一原件与解析版本，正式稿仍未创建", holdMs * 2);
      await page.screenshot({ path: resolve(out, "05-materials.png") });
    });
  }
} catch (error) {
  manifest.failure = redact(error);
  process.exitCode = 1;
} finally {
  await browser.close();
  manifest.status =
    manifest.failure || manifest.scenarios.some((entry) => entry.status === "failed")
      ? "failed"
      : manifest.scenarios.some((entry) => entry.status === "partial")
        ? "partial"
        : "passed";
  await writeFile(resolve(out, "manifest.json"), JSON.stringify(manifest, null, 2));
  if (manifest.status === "failed") process.exitCode = 1;
  console.log(JSON.stringify({ status: manifest.status, manifest: resolve(out, "manifest.json"), format: "WebM", mp4Produced: false }));
}
