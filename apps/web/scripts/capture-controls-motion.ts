import { chromium, type BrowserContext, type CDPSession, type Page } from "playwright";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

// Actual pointer/keyboard interactions only. No fixtures, injected state, or synthetic animations.
const file = resolve(process.argv[2] ?? "../../deliverables/thesispilot-design-preview.html");
const out = resolve("docs/design/screens");
const temporaryVideo = resolve(process.env.TEMP ?? "test-results", "thesispilot-controls-motion");
const viewport = { width: 1440, height: 1000 };
const filenames = {
  select: "2026-11-14-custom-select.png",
  calendar: "custom-calendar.png",
  video: "motion-demo.webm",
  manifest: "controls-motion-capture.json",
};

type RecorderWindow = typeof globalThis & {
  controlsRecorder: {
    draw: (jpeg: string) => Promise<void>;
    finish: () => Promise<{ base64: string; mimeType: string; bytes: number; width: number; height: number }>;
  };
};

// This isolated page only encodes Chrome's actual screencast frames. The app is never modified.
async function startBrowserRecording(target: Page) {
  const recorderContext = await browser.newContext({ viewport, deviceScaleFactor: 1 });
  let session: CDPSession | undefined;
  let accepting = true;
  let busy = false;
  let receivedFrames = 0;
  let encodedFrames = 0;
  let lastFrame = 0;
  let frameTask = Promise.resolve();
  const captureErrors: string[] = [];
  const recordingStarted = Date.now();
  try {
    const recorderPage = await recorderContext.newPage();
    await recorderPage.evaluate(({ width, height }) => {
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const painter = canvas.getContext("2d", { alpha: false });
      if (!painter) throw new Error("录制画布不可用。");
      const mimeType = "video/webm;codecs=vp8";
      if (!MediaRecorder.isTypeSupported(mimeType)) throw new Error("浏览器不支持 VP8 WebM 录制。");
      const stream = canvas.captureStream(15);
      const recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 3_000_000 });
      const chunks: Blob[] = [];
      let latest: ImageBitmap | undefined;
      recorder.addEventListener("dataavailable", ({ data }) => {
        if (data.size) chunks.push(data);
      });
      // Redrawing the latest real frame preserves the duration of still moments in the recording.
      const refresh = setInterval(() => {
        if (latest) painter.drawImage(latest, 0, 0, width, height);
      }, 1000 / 15);
      recorder.start(250);
      (globalThis as RecorderWindow).controlsRecorder = {
        async draw(jpeg) {
          const binary = atob(jpeg);
          const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
          const bitmap = await createImageBitmap(new Blob([bytes], { type: "image/jpeg" }));
          latest?.close();
          latest = bitmap;
          painter.drawImage(bitmap, 0, 0, width, height);
        },
        async finish() {
          await new Promise<void>((done, reject) => {
            recorder.addEventListener("stop", () => done(), { once: true });
            recorder.addEventListener("error", () => reject(new Error("浏览器录制编码失败。")), { once: true });
            recorder.stop();
          });
          clearInterval(refresh);
          stream.getTracks().forEach((track) => track.stop());
          latest?.close();
          const blob = new Blob(chunks, { type: mimeType });
          const base64 = await new Promise<string>((done, reject) => {
            const reader = new FileReader();
            reader.onload = () => {
              if (typeof reader.result === "string") done(reader.result.split(",")[1] ?? "");
              else reject(new Error("录制文件编码格式错误。"));
            };
            reader.onerror = () => reject(new Error("录制文件读取失败。"));
            reader.readAsDataURL(blob);
          });
          // Decode the resulting real recording in the isolated page before reporting success.
          const playback = document.createElement("video");
          const url = URL.createObjectURL(blob);
          try {
            await new Promise<void>((done, reject) => {
              playback.onloadeddata = () => done();
              playback.onerror = () => reject(new Error("生成的 WebM 无法解码。"));
              playback.src = url;
            });
            return { base64, mimeType, bytes: blob.size, width: playback.videoWidth, height: playback.videoHeight };
          } finally {
            playback.removeAttribute("src");
            playback.load();
            URL.revokeObjectURL(url);
          }
        },
      };
    }, viewport);
    session = await target.context().newCDPSession(target);
    const activeSession = session;
    activeSession.on("Page.screencastFrame", (frame: { data: string; sessionId: number }) => {
      // Acknowledge every received frame, including throttled frames, to keep Chrome streaming.
      void activeSession.send("Page.screencastFrameAck", { sessionId: frame.sessionId }).catch((error: Error) => {
        if (accepting) captureErrors.push(error.message);
      });
      receivedFrames += 1;
      if (!accepting || busy || Date.now() - lastFrame < 1000 / 15) return;
      busy = true;
      lastFrame = Date.now();
      frameTask = recorderPage
        .evaluate((jpeg) => (globalThis as RecorderWindow).controlsRecorder.draw(jpeg), frame.data)
        .then(() => {
          encodedFrames += 1;
        })
        .catch((error: Error) => captureErrors.push(error.message))
        .then(() => {
          busy = false;
        });
    });
    await target.bringToFront();
    await activeSession.send("Page.startScreencast", {
      format: "jpeg",
      quality: 90,
      maxWidth: viewport.width,
      maxHeight: viewport.height,
      everyNthFrame: 1,
    });
    return {
      async stop() {
        accepting = false;
        try {
          await activeSession.send("Page.stopScreencast");
          await frameTask;
          if (!encodedFrames || captureErrors.length) throw new Error(captureErrors.join("\n") || "未捕获真实页面帧。");
          const { base64, ...metadata } = await recorderPage.evaluate(() => (globalThis as RecorderWindow).controlsRecorder.finish());
          if (!metadata.bytes || metadata.width !== viewport.width || metadata.height !== viewport.height) {
            throw new Error("录制文件为空或视频尺寸不符。");
          }
          await writeFile(resolve(out, filenames.video), Buffer.from(base64, "base64"));
          return {
            method: "Chrome CDP screencast + isolated canvas MediaRecorder",
            targetFramesPerSecond: 15,
            receivedFrames,
            encodedFrames,
            elapsedMilliseconds: Date.now() - recordingStarted,
            ...metadata,
          };
        } finally {
          await activeSession.detach().catch(() => undefined);
          await recorderContext.close();
        }
      },
    };
  } catch (error) {
    accepting = false;
    await session?.detach().catch(() => undefined);
    await recorderContext.close();
    throw error;
  }
}

await mkdir(out, { recursive: true });
await mkdir(temporaryVideo, { recursive: true });
const browser = await chromium.launch({ channel: "chrome" });
let context: BrowserContext | undefined;
let page: Page;
let videoFallback = "";
try {
  context = await browser.newContext({ viewport, deviceScaleFactor: 1, recordVideo: { dir: temporaryVideo, size: viewport } });
  page = await context.newPage();
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  if (!/ffmpeg/i.test(message)) {
    await context?.close();
    await browser.close();
    throw error;
  }
  videoFallback = `本机 FFmpeg 不可用，改用 Chrome CDP 与浏览器 MediaRecorder 录制真实页面：${message}`;
  await context?.close();
  context = await browser.newContext({ viewport, deviceScaleFactor: 1 });
  page = await context.newPage();
}
const errors: string[] = [];
const warnings: string[] = [];
const actions: { action: string; milliseconds: number }[] = [];
const bounds: Record<string, Awaited<ReturnType<ReturnType<Page["locator"]>["boundingBox"]>>> = {};
const captures: string[] = [];
const started = Date.now();
const video = page.video();
let browserRecording: Awaited<ReturnType<typeof startBrowserRecording>> | undefined;
let videoCapture: Awaited<ReturnType<NonNullable<typeof browserRecording>["stop"]>> | undefined;
let recorded = false;
let failure = "";
page.on("pageerror", (error) => errors.push(error.message));
page.on("console", (message) => {
  if (message.type() === "error") errors.push(message.text());
  if (message.type() === "warning") warnings.push(message.text());
});
function log(action: string) {
  actions.push({ action, milliseconds: Date.now() - started });
}
async function hold(action: string, duration = 700) {
  log(action);
  await page.waitForTimeout(duration);
}
try {
  if (!video) {
    try {
      browserRecording = await startBrowserRecording(page);
    } catch (error) {
      videoFallback += `\n浏览器录制回退启动失败，仅保留截图：${error instanceof Error ? error.message : String(error)}`;
    }
  }
  await page.goto(pathToFileURL(file).href + "#/screens/projects");
  await page.evaluate(() => document.fonts.ready);
  await hold("打开项目页");
  await page.getByRole("button", { name: "新建项目", exact: true }).click();
  await hold("展开新建项目表单");
  const projectTitle = "自定义控件与动效演示";
  await page.getByRole("textbox", { name: "论文题目" }).fill(projectTitle);
  const stage = page.getByRole("combobox", { name: "当前阶段", exact: true });
  await stage.click();
  await hold("展开当前阶段自定义选择器", 850);
  const list = page.getByRole("listbox");
  await list.waitFor({ state: "visible" });
  bounds.selectTrigger = await stage.boundingBox();
  bounds.selectPanel = await list.boundingBox();
  await page.screenshot({ path: resolve(out, filenames.select), animations: "allow" });
  captures.push(filenames.select);
  await page.getByRole("option", { name: "论文撰写", exact: true }).hover();
  await hold("悬停阶段选项", 650);
  await page.getByRole("option", { name: "论文撰写", exact: true }).click();
  await hold("选择阶段并收起选项");

  const deadline = page.getByRole("textbox", { name: "重要截止日期" });
  const initialDate = await deadline.inputValue();
  const date = new Date(`${initialDate}T12:00:00`);
  if (!Number.isFinite(date.valueOf())) throw new Error("新项目截止日期不是可用的 ISO 日期。");
  date.setDate(15);
  date.setMonth(date.getMonth() + 1);
  const selectedDate = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-15`;
  await page.getByRole("button", { name: "打开日期选择器", exact: true }).click();
  await hold("打开自定义日历", 850);
  const calendar = page.getByRole("dialog", { name: "选择日期", exact: true });
  await calendar.getByRole("button", { name: "下个月", exact: true }).click();
  await hold("切换下一月份", 750);
  bounds.dateInput = await deadline.boundingBox();
  bounds.calendarPanel = await calendar.boundingBox();
  bounds.calendarGrid = await calendar.getByRole("grid").boundingBox();
  await page.screenshot({ path: resolve(out, filenames.calendar), animations: "allow" });
  captures.push(filenames.calendar);
  await calendar.getByRole("gridcell", { name: selectedDate, exact: true }).click();
  if ((await deadline.inputValue()) !== selectedDate) throw new Error("选择日期后输入值未同步，停止录制以免演示错误结果。");
  await hold("选择日期，日历离场");
  await page.getByRole("button", { name: "从空白文稿开始", exact: true }).click();
  const card = page.getByRole("article").filter({ has: page.getByRole("heading", { name: projectTitle, exact: true }) });
  await card.waitFor({ state: "visible" });
  await card.scrollIntoViewIfNeeded();
  await hold("保存并显示真实新增项目卡片", 900);

  await card.getByRole("button", { name: "归档", exact: true }).click();
  await hold("归档项目，卡片离场", 650);
  await page.getByRole("button", { name: "归档项目", exact: true }).click();
  await hold("显示归档列表", 650);
  await card.getByRole("button", { name: "恢复项目", exact: true }).click();
  await hold("恢复项目", 650);
  await page.getByRole("button", { name: "进行中的项目", exact: true }).click();
  await hold("显示恢复的项目卡片", 650);

  const navigation = page.getByRole("navigation", { name: "页面设计导航" });
  for (const name of ["计划", "配置", "写作"]) {
    await navigation.getByRole("link", { name, exact: true }).click();
    await hold(`切换到${name}页面`, 850);
  }
  await page.getByRole("textbox", { name: "论文正文编辑区", exact: true }).waitFor();
  await hold("保留写作台最终画面", 800);
} catch (error) {
  failure = error instanceof Error ? error.message : String(error);
} finally {
  if (browserRecording) {
    try {
      videoCapture = await browserRecording.stop();
      recorded = true;
    } catch (error) {
      videoFallback += `\n浏览器录制回退导出失败：${error instanceof Error ? error.message : String(error)}`;
    }
  }
  await context.close();
  if (video) {
    try {
      await video.saveAs(resolve(out, filenames.video));
      recorded = true;
    } catch (error) {
      videoFallback = `截图已保留，但录制文件未能导出：${error instanceof Error ? error.message : String(error)}`;
    }
  }
  await browser.close();
  const manifest = {
    file,
    viewport,
    elapsedMilliseconds: Date.now() - started,
    captures,
    video: recorded ? filenames.video : null,
    videoCapture,
    videoFallback,
    bounds,
    actions,
    errors,
    warnings,
    failure,
  };
  await writeFile(resolve(out, filenames.manifest), JSON.stringify(manifest, null, 2));
  console.log(JSON.stringify(manifest));
}
if (failure || errors.length) throw new Error(failure || errors.join("\n"));
