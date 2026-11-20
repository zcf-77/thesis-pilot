import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { expect } from "@playwright/test";
import { runTaskFeedbackScenario } from "../tests/e2e/scenarios/taskFeedbackScenario.ts";
import { runFormatScenario } from "../tests/e2e/scenarios/formatScenario.ts";
import { replaceManuscript } from "../tests/e2e/writing-helpers.ts";

// Run from apps/web. The key and authenticated storage stay in memory only.
// TP_COMPETITION_PROBE=1 checks recording without opening an application service.
const probe = process.env.TP_COMPETITION_PROBE === "1";
const modelStage = process.env.TP_COMPETITION_MODEL_STAGE ?? process.env.TP_WORKSPACE_TEST_MODEL_STAGE;
const scenarioIds = [
  "01-writing-history",
  "02-structure-task",
  "03-conflict-recovery",
  "04-configurations",
  "05-materials",
  "06-document-source",
  "07-content-assistant",
  "08-task-feedback",
  "09-safe-format",
];
const requestedScenarios = process.env.TP_COMPETITION_SCENARIOS;
const selectedScenarios =
  requestedScenarios === undefined
    ? scenarioIds.filter((id) => id !== "07-content-assistant" || modelStage === "missing")
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
if (!probe && selectedScenarios.includes("07-content-assistant") && modelStage !== "missing") {
  throw new Error("第07场景仅验证缺凭据失败恢复，请显式设置 TP_COMPETITION_MODEL_STAGE=missing；不代表模型成功验收。");
}
const origin = process.env.TP_COMPETITION_ORIGIN ?? process.env.TP_WORKSPACE_TEST_ORIGIN;
const accessKey = process.env.TP_COMPETITION_ACCESS_KEY ?? process.env.TP_WORKSPACE_TEST_ACCESS_KEY;
if (!probe && (!origin || !/^http:\/\/127\.0\.0\.1:\d+$/.test(origin))) throw new Error("请设置本机专用 TP_COMPETITION_ORIGIN。");
if (!probe && !accessKey) throw new Error("请通过进程环境提供 TP_COMPETITION_ACCESS_KEY。");
const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const runId = new Date().toISOString().replace(/[:.]/g, "-");
const out = resolve(process.env.TP_COMPETITION_OUT ?? resolve(root, "work/competition-evidence", runId));
const viewport = {
  width: Number(process.env.TP_COMPETITION_WIDTH ?? 1920),
  height: Number(process.env.TP_COMPETITION_HEIGHT ?? 1080),
};
if (!Number.isInteger(viewport.width) || !Number.isInteger(viewport.height) || viewport.width < 640 || viewport.width > 3840 || viewport.height < 360 || viewport.height > 2160) {
  throw new Error("录屏尺寸须为 640—3840 像素宽、360—2160 像素高的整数；4K 使用 3840×2160。");
}
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
  await page.getByLabel("项目名称").fill(`合成演示 · ${label} · ${runId}`);
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
        '<!doctype html><meta charset="utf-8"><title>录屏工具检查</title><body style="background:#faf7f0;color:#342b26;font:48px sans-serif;padding:100px"><h1>ThesisPilot 录屏工具检查</h1><p>此片段验证真实帧录制与播放，实际尺寸以清单为准。</p><button style="font:inherit;padding:24px">检查真实鼠标操作</button></body>',
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
      await page.getByLabel("工作区访问口令").fill(accessKey);
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
      await replaceManuscript(page, text);
      await step("在正文中输入自制文稿");
      const document = await save(page, projectId);
      assert.equal(document.version, 3);
      await step("显式保存为正式稿 v3");
      await page.getByRole("tab", { name: "版本", exact: true }).click();
      await expect(page.getByRole("region", { name: "正式稿版本", exact: true })).toBeVisible();
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
      await replaceManuscript(page, savedText);
      await save(page, projectId);
      await step("保存用于检查的正式稿 v3");
      await replaceManuscript(page, "这是尚未保存的后续草稿，不应进入 v3 的检查统计。");
      await expect(page.getByText("草稿已保留在本机", { exact: true })).toBeVisible();
      const accepted = page.waitForResponse((response) => response.request().method() === "POST" && response.url().endsWith("/api/v1/jobs"));
      await page.getByRole("tab", { name: "审阅", exact: true }).click();
      await page.getByRole("button", { name: "检查正文结构", exact: true }).click();
      const response = await accepted;
      assert.equal(response.status(), 202);
      const job = await response.json();
      entry.jobId = job.id;
      assert.equal(job.resource_scope.document_version, 3);
      await step("提交固定 v3 的检查，当前草稿保持原样");
      await page.getByRole("link", { name: "查看正式稿 v3 的结构检查", exact: true }).click();
      const detail = page.locator(".job-detail");
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
      assert.equal(record.artifacts[0].result.document_version, 3);
      assert.equal(record.artifacts[0].result.text_characters, Array.from(savedText).length);
      entry.result = { documentVersion: 3, textCharacters: record.artifacts[0].result.text_characters };
      await step("真实 worker 结果明确绑定 v3");
      await page.reload();
      await expect(result).toBeVisible();
      await step("刷新后恢复同一任务结果", holdMs * 2);
      await page.screenshot({ path: resolve(out, "02-structure-task.png") });
    });

    await scenario("03-conflict-recovery", "双窗口真实冲突与草稿恢复", async ({ page, entry, step }) => {
      const { projectId, writingUrl } = await newManuscript(page, step, "冲突恢复");
      entry.projectId = projectId;
      await replaceManuscript(page, "两个窗口共同读取的自制基础版本。");
      await save(page, projectId);
      const second = await browser.newContext({ baseURL: origin, viewport, storageState });
      try {
        const other = await second.newPage();
        await other.goto(writingUrl);
        await expect(editor(other)).toContainText("两个窗口共同读取的自制基础版本。");
        const local = "窗口甲尚未提交的自制草稿，冲突后必须保留。";
        const remote = "窗口乙先保存的自制新版本。";
        await replaceManuscript(page, local);
        await expect(page.getByText("草稿已保留在本机", { exact: true })).toBeVisible();
        await step("窗口甲在 v3 上编辑并保留本机草稿");
        await replaceManuscript(other, remote);
        const document = await save(other, projectId);
        assert.equal(document.version, 4);
        await page.bringToFront();
        await save(page, projectId, 409);
        await expect(editor(page)).toContainText(local);
        await step("窗口乙先保存 v4；窗口甲提交得到真实 409，原输入保留", holdMs * 2);
        const conflict = page.getByRole("dialog", { name: "正式稿已在别处更新", exact: true });
        await expect(conflict).toBeVisible();
        await conflict.getByRole("button", { name: "载入最新版本", exact: true }).click();
        await expect(editor(page)).toContainText(remote);
        await step("显式保留冲突草稿并载入服务端 v4");
        await page.getByRole("button", { name: /^本机草稿（/ }).click();
        const preserved = page.getByRole("menuitem", { name: /^恢复基于 v3 的草稿/ });
        await expect(preserved).toBeVisible();
        await step("查看仍保留的 v3 草稿");
        await preserved.click();
        await expect(editor(page)).toContainText(local);
        await page.reload();
        await expect(editor(page)).toContainText(local);
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
      await page.getByLabel("项目名称").fill(projectName);
      await page.getByRole("button", { name: "创建项目", exact: true }).click();
      await expect(page).toHaveURL(/\/projects\/[a-f0-9-]+\/write$/);
      const projectId = page.url().match(/\/projects\/([a-f0-9-]+)\/write$/)[1];
      entry.projectId = projectId;
      await step("创建合成试跑项目，保留正式稿为空");
      await page.goto("/#/configurations");
      await expect(page.getByRole("heading", { name: "配置台", exact: true })).toBeVisible();
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
      await page.getByRole("tab", { name: "AI 接口", exact: true }).click();
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
      await trial.getByLabel("试跑变量 JSON").fill(JSON.stringify({ context: syntheticText }));
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
      await expect(result).toContainText("第一章 绪论");
      await result.scrollIntoViewIfNeeded();
      await step("查看真实解析文本与部分识别结果", holdMs * 2);
      const diagnostics = page.locator("details").filter({ hasText: "未识别内容与解析说明" }).first();
      await diagnostics.scrollIntoViewIfNeeded();
      await diagnostics.locator("summary").click();
      await expect(diagnostics).toContainText("受保护投影");
      await step("公式与未知结构保留原包，明确显示保护与支持限制", holdMs * 2);
      const formula = result.locator(".library-fragment").filter({ hasText: "x=1" }).first();
      await formula.scrollIntoViewIfNeeded();
      await expect(formula).toContainText("受保护对象");
      await step("定位原生公式来源与只读映射", holdMs * 2);
      await page.screenshot({ path: resolve(out, "05-materials-source.png") });
      const downloadButton = page.getByRole("button", { name: "下载原件", exact: true });
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
      await page.getByRole("button", { name: "版本记录", exact: true }).click();
      const originals = page.getByRole("region", { name: "版本记录", exact: true });
      await originals.getByText("原件校验", { exact: true }).click();
      await expect(originals).toContainText(sha256);
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

    await scenario("06-document-source", "固定DOCX来源导入、章节校正与逐版映射", async ({ page, entry, step }) => {
      const fixturePath = resolve(root, "work/competition-evidence/material-fixtures/synthetic-manuscript.docx");
      const fixture = await readFile(fixturePath);
      const sha256 = createHash("sha256").update(fixture).digest("hex");
      const projectName = `合成来源导入录屏 ${runId}`;
      const materialName = `合成导入原件 ${runId}`;
      const choose = async (scope, label, option) => {
        const control = scope.getByRole("combobox", { name: label, exact: true });
        await expect(control).toBeEnabled();
        await control.click();
        await page.getByRole("option", { name: option, exact: true }).click();
      };
      await page.goto("/#/projects");
      await expect(page.getByRole("heading", { name: "论文项目", exact: true })).toBeVisible();
      await page.getByRole("button", { name: "新建项目", exact: true }).click();
      await page.getByLabel("项目名称").fill(projectName);
      await page.getByRole("button", { name: "创建项目", exact: true }).click();
      await expect(page).toHaveURL(/\/projects\/[a-f0-9-]+\/write$/);
      const writingUrl = page.url();
      const projectId = writingUrl.match(/\/projects\/([a-f0-9-]+)\/write$/)[1];
      entry.projectId = projectId;
      await step("通过真实界面创建独立合成项目，暂不建立空白正式稿");
      await page.getByRole("link", { name: "资料", exact: true }).click();
      await expect(page.getByRole("heading", { name: "项目资料", level: 1, exact: true })).toBeVisible();
      await page.getByRole("button", { name: "上传资料", exact: true }).click();
      const upload = page.getByRole("region", { name: "上传资料", exact: true });
      await upload.getByLabel("资料文件", { exact: true }).setInputFiles(fixturePath);
      await upload.getByLabel("资料名称").fill(materialName);
      await choose(upload, "资料分类", "其他资料");
      await upload.getByLabel("资料来源").fill("自制校园图书检索系统演示DOCX，含原生公式；无真实用户资料。");
      await step("上传自制DOCX作为固定原件，不提交客户端正文JSON");
      const materialRoot = `/api/v1/projects/${projectId}/materials`;
      const uploaded = page.waitForResponse((response) => response.request().method() === "POST" && new URL(response.url()).pathname === materialRoot);
      await upload.getByRole("button", { name: "上传并解析", exact: true }).click();
      const uploadedResponse = await uploaded;
      assert.equal(uploadedResponse.status(), 201);
      const material = await uploadedResponse.json();
      assert.equal(material.original.sha256, sha256);
      assert.equal(material.original.byte_size, fixture.length);
      assert.equal(material.job.kind, "material_parse");
      entry.materialId = material.material.id;
      entry.originalId = material.original.id;
      entry.jobId = material.job.id;
      await expect(upload).toHaveCount(0);
      await step("原件保存成功，真实 worker 解析任务已入队");
      await expect
        .poll(
          async () => {
            const response = await page.request.get(`/api/v1/jobs/${material.job.id}?project_id=${projectId}`);
            assert.equal(response.status(), 200);
            const job = await response.json();
            if (["failed", "cancelled"].includes(job.status)) throw new Error(`来源解析任务已${job.status}：${job.error_code ?? "无错误码"}`);
            return job.status;
          },
          { timeout: jobTimeout },
        )
        .toBe("succeeded");
      const completedResponse = await page.request.get(`/api/v1/jobs/${material.job.id}?project_id=${projectId}`);
      assert.equal(completedResponse.status(), 200);
      const completed = await completedResponse.json();
      assert.equal(completed.artifacts.length, 1);
      const parsed = completed.artifacts[0].result;
      assert.equal(parsed.original_version_id, material.original.id);
      assert.equal(parsed.original_sha256, sha256);
      assert.equal(parsed.model_used, false);
      assert.equal(parsed.writes_performed, false);
      assert.equal((await page.request.get(`/api/v1/projects/${projectId}/documents/current`)).status(), 404);
      await step("真实解析已完成，未调用模型，正式稿仍为空");
      await page.getByRole("link", { name: "写作", exact: true }).click();
      await expect(page).toHaveURL(writingUrl);
      await page.getByRole("button", { name: "从资料导入", exact: true }).click();
      const importer = page.getByRole("region", { name: "从资料导入", exact: true });
      await expect(importer).toBeVisible();
      await choose(importer, "导入资料", materialName);
      await choose(importer, "导入原件版本", "原件 v1 · synthetic-manuscript.docx");
      await choose(importer, "导入解析版本", "解析 v1 · 部分");
      const previewed = page.waitForResponse(
        (response) => response.request().method() === "POST" && new URL(response.url()).pathname === `/api/v1/projects/${projectId}/document-import/preview`,
      );
      await importer.getByRole("button", { name: "预览导入范围", exact: true }).click();
      const previewResponse = await previewed;
      assert.equal(previewResponse.status(), 200);
      const preview = await previewResponse.json();
      assert.equal(preview.original_version_id, material.original.id);
      assert.equal(preview.parse_version_id, parsed.parse_version_id);
      assert.equal(preview.original_sha256, sha256);
      assert.equal(preview.can_import, true);
      const chapters = importer.getByRole("region", { name: "原始章节预览", exact: true });
      await expect(chapters).toContainText(sha256);
      await step("预览固定原件与解析版本，核对SHA和受保护对象支持范围", holdMs * 2);
      const firstChapter = chapters.getByRole("article", { name: "导入章节 1", exact: true });
      const secondChapter = chapters.getByRole("article", { name: "导入章节 2", exact: true });
      await expect(firstChapter).toContainText("第一章 绪论");
      await choose(firstChapter, "导入后标题级别", "2级标题");
      await choose(secondChapter, "导入后类型", "标题");
      await choose(secondChapter, "导入后标题级别", "3级标题");
      await step("显式把原一级标题校正为二级，并将第二段校正为三级标题；原件保持原样", holdMs * 2);
      const imported = page.waitForResponse(
        (response) => response.request().method() === "POST" && new URL(response.url()).pathname === `/api/v1/projects/${projectId}/document-import`,
      );
      await chapters.getByRole("button", { name: "确认导入正式稿", exact: true }).click();
      const importResponse = await imported;
      assert.equal(importResponse.status(), 201);
      const receipt = await importResponse.json();
      const command = importResponse.request().postDataJSON();
      assert.equal(command.chapter_corrections.length, 2);
      assert.ok(command.chapter_corrections.some((item) => item.kind === "heading" && item.level === 2));
      assert.ok(command.chapter_corrections.some((item) => item.kind === "heading" && item.level === 3));
      assert.equal(receipt.document_version, 1);
      assert.equal(receipt.original_version_id, material.original.id);
      assert.equal(receipt.parse_version_id, parsed.parse_version_id);
      entry.documentId = receipt.document_id;
      entry.sourceId = receipt.source_id;
      entry.importCommandId = receipt.command_id;
      entry.chapterCorrections = command.chapter_corrections;
      await expect(importer).toHaveCount(0);
      await expect(editor(page)).toBeVisible();
      await expect(editor(page).getByRole("heading", { name: "第一章 绪论", level: 2, exact: true })).toBeVisible();
      const source = page.getByRole("region", { name: "正式稿来源", exact: true });
      await expect(source).toContainText("已应用 2 项章节校正");
      await expect(source).toContainText(sha256);
      await expect(page.getByRole("button", { name: "加粗", exact: true })).toBeDisabled();
      await source.scrollIntoViewIfNeeded();
      await step("明确确认后创建正式稿 v1，服务器保留来源与两项章节校正映射", holdMs * 2);
      const currentResponse = await page.request.get(`/api/v1/projects/${projectId}/documents/current`);
      assert.equal(currentResponse.status(), 200);
      const originalDocument = await currentResponse.json();
      assert.equal(originalDocument.id, receipt.document_id);
      assert.equal(originalDocument.version, 1);
      assert.equal(originalDocument.content.json.content[0].attrs.level, 2);
      assert.equal(originalDocument.content.json.content[1].attrs.level, 3);
      const originalSourceResponse = await page.request.get(
        `/api/v1/projects/${projectId}/documents/${receipt.document_id}/source?expected_document_version=1`,
      );
      assert.equal(originalSourceResponse.status(), 200);
      const originalSource = await originalSourceResponse.json();
      assert.equal(originalSource.source_id, receipt.source_id);
      assert.equal(originalSource.original_sha256, sha256);
      const bodyText = "论文正文不少于8000字。";
      const addition = "合成保存验证。";
      const paragraph = editor(page).locator("p").filter({ hasText: bodyText });
      await expect(paragraph).toHaveText(bodyText);
      await paragraph.scrollIntoViewIfNeeded();
      await paragraph.click();
      await page.keyboard.press("End");
      await page.keyboard.insertText(addition);
      await expect(paragraph).toHaveText(bodyText + addition);
      await step("仅编辑已映射文字槽，保留原有数字、章节与公式结构");
      const saved = await save(page, projectId);
      assert.equal(saved.version, 2);
      const expectedJson = structuredClone(originalDocument.content.json);
      const editedNode = expectedJson.content.find((node) => node.type === "paragraph" && node.content?.some((child) => child.text === bodyText));
      assert.ok(editedNode, "合成原稿缺少可编辑的目标文字槽。");
      editedNode.content.find((child) => child.text === bodyText).text += addition;
      assert.deepEqual(saved.content.json, expectedJson, "保存只应改变本次映射文字，不能改写公式或章节结构。");
      await step("保存为正式稿 v2，正文与逐版来源映射同事务落库");
      await page.reload();
      await expect(editor(page)).toContainText(bodyText + addition);
      await expect(source).toContainText("正式稿 v2");
      await expect(source).toContainText(sha256);
      const currentSourceResponse = await page.request.get(`/api/v1/projects/${projectId}/documents/${receipt.document_id}/source?expected_document_version=2`);
      assert.equal(currentSourceResponse.status(), 200);
      const currentSource = await currentSourceResponse.json();
      assert.equal(currentSource.document_version, 2);
      assert.equal(currentSource.source_id, originalSource.source_id);
      assert.deepEqual(currentSource.guard_contract, originalSource.guard_contract);
      await source.scrollIntoViewIfNeeded();
      await step("刷新恢复已保存正文 v2 和相同固定来源保护映射", holdMs * 2);
      await page.screenshot({ path: resolve(out, "06-document-source-current.png") });
      entry.originalDownloads = [];
      const verifyOriginalDownload = async (scope, version) => {
        const button = scope.getByRole("button", { name: "下载来源原件", exact: true });
        await button.scrollIntoViewIfNeeded();
        const downloading = page.waitForEvent("download");
        await button.click();
        const download = await downloading;
        const path = resolve(out, `06-source-v${version}-synthetic-manuscript.docx`);
        await download.saveAs(path);
        const downloaded = await readFile(path);
        const downloadedSha = createHash("sha256").update(downloaded).digest("hex");
        assert.deepEqual(downloaded, fixture);
        assert.equal(downloadedSha, sha256);
        entry.originalDownloads.push({
          documentVersion: version,
          filename: download.suggestedFilename(),
          path,
          bytes: downloaded.length,
          sha256: downloadedSha,
          matchesFixture: true,
        });
      };
      await verifyOriginalDownload(source, 2);
      await step("从当前正式稿来源实际下载原件，确认字节和SHA与上传文件完全一致", holdMs * 2);
      await page.getByRole("button", { name: "版本历史", exact: true }).click();
      const history = page.getByRole("complementary", { name: "版本历史", exact: true });
      await expect(history).toBeVisible();
      const firstVersion = history.locator(".tp-vt__item").filter({ has: page.getByText("v1", { exact: true }) });
      await firstVersion.getByRole("button", { name: "对比", exact: true }).click();
      await expect(page).toHaveURL(new RegExp(`/projects/${projectId}/documents/${receipt.document_id}/versions/1\\?`));
      const historicalSource = history.getByRole("region", { name: "历史正式稿来源", exact: true });
      await expect(historicalSource).toContainText("正式稿 v1");
      await expect(historicalSource).toContainText(sha256);
      const comparison = history.getByRole("region", { name: "正式稿版本对比", exact: true });
      await expect(comparison).toContainText(bodyText + addition);
      await historicalSource.scrollIntoViewIfNeeded();
      await step("通过版本历史打开不可变 v1，历史来源仍指向同一原件与解析版本", holdMs * 2);
      await page.reload();
      await expect(historicalSource).toContainText(sha256);
      const historicalResponse = await page.request.get(`/api/v1/projects/${projectId}/documents/${receipt.document_id}/versions/1/source`);
      assert.equal(historicalResponse.status(), 200);
      const historical = await historicalResponse.json();
      assert.equal(historical.document_version, 1);
      assert.equal(historical.source_id, currentSource.source_id);
      assert.equal(historical.original_version_id, material.original.id);
      assert.equal(historical.parse_version_id, parsed.parse_version_id);
      assert.deepEqual(historical.guard_contract, originalSource.guard_contract);
      await verifyOriginalDownload(historicalSource, 1);
      entry.result = {
        parseVersionId: parsed.parse_version_id,
        documentVersions: [1, 2],
        chapterCorrections: command.chapter_corrections.length,
        immutableHistorySourceVerified: true,
        refreshedCurrentAndHistoricalSource: true,
        modelUsed: parsed.model_used,
      };
      await step("刷新历史来源并实际下载 v1 原件，再次确认完整原包与SHA一致", holdMs * 2);
      await page.screenshot({ path: resolve(out, "06-document-source.png") });
    });

    await scenario("07-content-assistant", "内容助手独立草稿、缺凭据失败与固定输入重试", async ({ page, entry, step }) => {
      entry.modelStage = "missing";
      entry.expectedFailure = "MODEL_NOT_CONFIGURED";
      entry.modelSuccessClaimed = false;
      entry.seededViaApi = false;
      entry.seededConfigs = [];
      await page.goto("/#/projects");
      await expect(page.getByRole("heading", { name: "论文项目", exact: true })).toBeVisible();
      const availabilityResponse = await page.request.get("/api/v1/ai-configs/availability");
      assert.equal(availabilityResponse.status(), 200);
      const availability = await availabilityResponse.json();
      assert.equal(availability.credential_configured, false, "第07片段要求专用无模型凭据环境，已配置凭据时不能继续缺凭据场景。");
      entry.credentialAvailability = { credentialConfigured: availability.credential_configured };
      const seed = async (kind, label, content) => {
        const response = await page.request.post("/api/v1/ai-configs", {
          headers: { Origin: origin },
          data: { name: `${label} ${runId}`, content },
        });
        assert.equal(response.status(), 201);
        const config = await response.json();
        entry.seededViaApi = true;
        entry.seededConfigs.push({ kind, id: config.id, versionId: config.current_version_id, createdVia: "API" });
        return config;
      };
      const api = await seed("api", "合成助手接口", { kind: "api", max_retries: 2 });
      const model = await seed("model", "合成内容模型", {
        kind: "model",
        api_version_id: api.current_version_id,
        model_code: "deepseek-flash",
        capabilities: ["text"],
      });
      const prompt = await seed("prompt", "合成内容提示", {
        kind: "prompt",
        template: "按明确目标处理合成选区。目标：{{goal}}；背景：{{context}}",
        variables: ["goal", "context"],
      });
      const agent = await seed("agent", "合成内容助手", {
        kind: "agent",
        role: "content",
        instructions: "只返回指定合成选区的建议，不改数字、引用或锁定内容。",
        model_version_id: model.current_version_id,
        prompt_version_id: prompt.current_version_id,
      });
      await step("API准备四库合成配置；此片段不演示四库新增界面，不录入任何模型凭据");
      const { projectId } = await newManuscript(page, step, "内容助手失败恢复");
      entry.projectId = projectId;
      const projectRoot = `/api/v1/projects/${projectId}`;
      const text = "本研究采用方法甲。这是自制内容助手验收文本。";
      await replaceManuscript(page, text);
      const original = await save(page, projectId);
      assert.equal(original.version, 3);
      entry.documentId = original.id;
      await step("显式保存合成正式稿 v3，助手仅使用本次已保存选区");
      await page.getByRole("tab", { name: "助手", exact: true }).click();
      const workspace = page.getByRole("region", { name: "内容助手", exact: true });
      await expect(workspace).toBeVisible();
      const createSession = async (title) => {
        const trigger = workspace.getByRole("button", { name: "新建会话", exact: true });
        if (await trigger.count()) await trigger.click();
        await workspace.getByLabel("新会话名称", { exact: true }).fill(title);
        const submitted = page.waitForResponse(
          (response) => response.request().method() === "POST" && new URL(response.url()).pathname === `${projectRoot}/assistant-sessions`,
        );
        await workspace.getByRole("button", { name: "创建会话", exact: true }).click();
        const response = await submitted;
        assert.equal(response.status(), 201);
        return await response.json();
      };
      const titleA = `合成会话甲 ${runId}`;
      const titleB = `合成会话乙 ${runId}`;
      const paneA = workspace.getByRole("region", { name: `内容助手会话：${titleA}`, exact: true });
      const paneB = workspace.getByRole("region", { name: `内容助手会话：${titleB}`, exact: true });
      const chooseSession = async (title, pane) => {
        await workspace.getByRole("combobox", { name: "当前内容会话", exact: true }).click();
        await page.getByRole("option", { name: title, exact: true }).click();
        await expect(pane).toBeVisible();
      };
      const firstSession = await createSession(titleA);
      const goalA = "仅润色当前合成选区，保留原意。";
      const goalB = "另一会话独立草稿，暂不发送。";
      await expect(paneA).toBeVisible();
      await paneA.getByLabel("内容修订目标（本机草稿）").fill(goalA);
      await expect(paneA).toContainText("草稿已保留");
      const secondSession = await createSession(titleB);
      await expect(paneB).toBeVisible();
      await paneB.getByLabel("内容修订目标（本机草稿）").fill(goalB);
      await expect(paneB).toContainText("草稿已保留");
      await chooseSession(titleA, paneA);
      await expect(paneA.getByLabel("内容修订目标（本机草稿）")).toHaveValue(goalA);
      entry.sessionIds = [firstSession.id, secondSession.id];
      await paneA.getByLabel("内容修订目标（本机草稿）").scrollIntoViewIfNeeded();
      await step("两会话分别保留本机草稿，未发送文字不是正式消息", holdMs * 2);
      await page.screenshot({ path: resolve(out, "07-content-assistant-drafts.png") });
      await editor(page).click();
      await editor(page).press("ControlOrMeta+A");
      await expect(workspace.getByRole("region", { name: "当前纸面选区", exact: true })).toContainText(`正式稿 v3`);
      await paneA.getByRole("button", { name: "使用当前选区", exact: true }).click();
      await expect(paneA.locator(".assistant-selection")).toContainText(text);
      await paneA.getByRole("button", { name: "上下文", exact: true }).click();
      const context = paneA.getByRole("region", { name: "助手固定上下文", exact: true });
      const choose = async (label, option) => {
        const control = context.getByRole("combobox", { name: label, exact: true });
        await expect(control).toBeEnabled();
        await control.click();
        await page.getByRole("option", { name: option, exact: true }).click();
      };
      await choose("内容助手版本", `${agent.name} · v1`);
      await choose("模板与要求", "本次不包含模板与要求");
      await expect(context.getByRole("combobox", { name: "添加资料", exact: true })).toContainText("选择资料解析版本");
      await expect(context.locator(".assistant-source")).toHaveCount(0);
      await expect(paneA).toContainText("本次不包含模板与要求");
      await paneA.getByRole("checkbox", { name: "已核对本次版本与资料范围", exact: true }).check();
      await step("明确固定 v3 选区与内容助手 v1，本次不包含资料或模板要求绑定", holdMs * 2);
      const submitted = page.waitForResponse(
        (response) =>
          response.request().method() === "POST" && new URL(response.url()).pathname === `${projectRoot}/assistant-sessions/${firstSession.id}/runs`,
      );
      await paneA.getByRole("button", { name: "发送选区修订", exact: true }).click();
      const submittedResponse = await submitted;
      assert.equal(submittedResponse.status(), 202);
      const receipt = await submittedResponse.json();
      entry.runIds = [receipt.run.id];
      const getRun = async (runId) => {
        const response = await page.request.get(`${projectRoot}/assistant-runs/${runId}`);
        assert.equal(response.status(), 200);
        return await response.json();
      };
      const waitForMissingCredentialFailure = async (runId) => {
        await expect
          .poll(
            async () => {
              const run = await getRun(runId);
              if (["succeeded", "cancelled"].includes(run.status)) throw new Error(`缺凭据失败场景返回了${run.status}，不能按预期失败验收。`);
              return run.status;
            },
            { timeout: jobTimeout },
          )
          .toBe("failed");
        const run = await getRun(runId);
        assert.equal(run.error_code, "MODEL_NOT_CONFIGURED");
        assert.equal(run.result_message_id, null);
        assert.equal(run.candidate_id, null);
        assert.equal(run.document_version, 3);
        return run;
      };
      await step("通过真实界面发送选区修订，服务端保存消息并派发真实 worker");
      const firstRun = await waitForMissingCredentialFailure(receipt.run.id);
      await paneA.getByRole("button", { name: "刷新状态", exact: true }).click();
      await expect(paneA.getByRole("region", { name: "当前对话", exact: true })).toContainText(goalA);
      await paneA.getByText("错误详情", { exact: true }).click();
      await expect(paneA.locator(".assistant-technical code")).toHaveText("MODEL_NOT_CONFIGURED");
      const requestedContext = page.waitForResponse(
        (response) => response.request().method() === "GET" && new URL(response.url()).pathname === `${projectRoot}/assistant-runs/${receipt.run.id}/context`,
      );
      await paneA.getByRole("button", { name: "固定输入", exact: true }).click();
      const fixedContextResponse = await requestedContext;
      assert.equal(fixedContextResponse.status(), 200);
      const fixedContext = await fixedContextResponse.json();
      assert.equal(fixedContext.input.document_id, original.id);
      assert.equal(fixedContext.input.document_version, 3);
      assert.equal(fixedContext.input.agent_config_version_id, agent.current_version_id);
      assert.equal(fixedContext.input.source_binding_version_id, null);
      assert.deepEqual(fixedContext.input.material_sources, []);
      assert.equal(fixedContext.input.selection.expected_text, text);
      assert.equal(fixedContext.input.goal, goalA);
      const fixedContextPanel = paneA.getByRole("region", { name: "本次固定输入", exact: true });
      await expect(fixedContextPanel).toContainText(text);
      await expect(fixedContextPanel).toContainText("未包含模板与要求绑定");
      await fixedContextPanel.scrollIntoViewIfNeeded();
      await step("真实 worker 因未配置模型凭据失败；保留原消息与固定上下文，没有模型回复或可采纳候选", holdMs * 2);
      await page.screenshot({ path: resolve(out, "07-content-assistant-failure.png") });
      await page.reload();
      await page.getByRole("tab", { name: "助手", exact: true }).click();
      await chooseSession(titleA, paneA);
      await expect(paneA).toContainText("MODEL_NOT_CONFIGURED");
      await expect(paneA.getByRole("region", { name: "当前对话", exact: true })).toContainText(goalA);
      await chooseSession(titleB, paneB);
      await expect(paneB.getByLabel("内容修订目标（本机草稿）")).toHaveValue(goalB);
      await chooseSession(titleA, paneA);
      const freshDraft = "这条新本机草稿不应替换重试的固定目标。";
      await paneA.getByLabel("内容修订目标（本机草稿）").fill(freshDraft);
      await step("刷新后消息与失败状态恢复，乙会话草稿独立保留；新草稿不改变原运行输入", holdMs * 2);
      const retried = page.waitForResponse(
        (response) => response.request().method() === "POST" && new URL(response.url()).pathname === `${projectRoot}/assistant-runs/${receipt.run.id}/retry`,
      );
      await paneA.getByRole("button", { name: "重试固定输入", exact: true }).click();
      const retryResponse = await retried;
      assert.equal(retryResponse.status(), 202);
      const retry = await retryResponse.json();
      assert.notEqual(retry.run.id, receipt.run.id);
      assert.equal(retry.run.source_run_id, receipt.run.id);
      entry.runIds.push(retry.run.id);
      await step("显式重试创建新运行，并保留第一次失败记录与原消息");
      const retriedRun = await waitForMissingCredentialFailure(retry.run.id);
      const retriedContextResponse = await page.request.get(`${projectRoot}/assistant-runs/${retry.run.id}/context`);
      assert.equal(retriedContextResponse.status(), 200);
      const retriedContext = await retriedContextResponse.json();
      assert.deepEqual(retriedContext.input, fixedContext.input);
      const messageResponse = await page.request.get(`${projectRoot}/assistant-sessions/${firstSession.id}/messages`);
      assert.equal(messageResponse.status(), 200);
      const messages = await messageResponse.json();
      assert.equal(messages.total, 1);
      assert.equal(messages.items[0].role, "user");
      assert.equal(messages.items[0].content, goalA);
      const otherMessageResponse = await page.request.get(`${projectRoot}/assistant-sessions/${secondSession.id}/messages`);
      assert.equal(otherMessageResponse.status(), 200);
      assert.equal((await otherMessageResponse.json()).total, 0);
      const currentResponse = await page.request.get(`${projectRoot}/documents/current`);
      assert.equal(currentResponse.status(), 200);
      assert.deepEqual(await currentResponse.json(), original);
      const versionsResponse = await page.request.get(`${projectRoot}/documents/${original.id}/versions`);
      assert.equal(versionsResponse.status(), 200);
      assert.equal((await versionsResponse.json()).total, 3);
      await paneA.getByRole("button", { name: "刷新状态", exact: true }).click();
      await expect(paneA).toContainText("MODEL_NOT_CONFIGURED");
      await expect(paneA.getByLabel("内容修订目标（本机草稿）")).toHaveValue(freshDraft);
      await chooseSession(titleB, paneB);
      await expect(paneB.getByLabel("内容修订目标（本机草稿）")).toHaveValue(goalB);
      await chooseSession(titleA, paneA);
      await expect(editor(page)).toContainText(text);
      entry.result = {
        expectedFailureVerified: "MODEL_NOT_CONFIGURED",
        firstRunStatus: firstRun.status,
        retryRunStatus: retriedRun.status,
        fixedInputPreserved: true,
        firstSessionMessages: messages.total,
        secondSessionMessages: 0,
        independentDraftsPreserved: true,
        unchangedDocumentVersion: original.version,
        modelSucceeded: false,
        resultMessageProduced: false,
        candidatePublished: false,
      };
      await paneA.getByRole("region", { name: "本次运行", exact: true }).scrollIntoViewIfNeeded();
      await step("固定输入重试仍明确失败；没有重复消息、模型回复或正文改写，两会话草稿保持独立", holdMs * 2);
      await page.screenshot({ path: resolve(out, "07-content-assistant.png") });
    });
    await scenario("08-task-feedback", "任务版本证据复核、人工反馈及学生处理撤销", async ({ page, entry, step }) => {
      await page.goto("/#/projects");
      await expect(page.getByRole("heading", { name: "论文项目", exact: true })).toBeVisible();
      entry.result = await runTaskFeedbackScenario(page, {
        suffix: runId,
        step,
        screenshot: async (name) => {
          await page.screenshot({ path: resolve(out, `08-${name}.png`) });
        },
      });
      await page.screenshot({ path: resolve(out, "08-task-feedback.png") });
    });
    await scenario("09-safe-format", "真实格式依据、部分采纳、撤销和过期保护", async ({ page, entry, step }) => {
      await page.goto("/#/projects");
      await expect(page.getByRole("heading", { name: "论文项目", exact: true })).toBeVisible();
      entry.seededViaApi = true;
      entry.result = await runFormatScenario(page, {
        origin,
        suffix: runId,
        step,
        screenshot: async (name) => {
          await page.screenshot({ path: resolve(out, `09-${name}`) });
        },
      });
      await page.screenshot({ path: resolve(out, "09-safe-format.png") });
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
