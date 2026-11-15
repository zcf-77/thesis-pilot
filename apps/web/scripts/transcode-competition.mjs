import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { access, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "../../..");
const require = createRequire(resolve(root, "apps/web/package.json"));
const { chromium } = require("playwright");
if (process.argv.length !== 3 || !process.argv[2]?.trim()) {
  throw new Error("用法：从 apps/web 运行 node scripts/transcode-competition.mjs <manifest目录>；必须显式提供目录。");
}
const directory = resolve(process.argv[2]);
const sourceManifestPath = resolve(directory, "manifest.json");
const outputManifestPath = resolve(directory, "mp4-transcode-manifest.json");
const sourceManifestBytes = await readFile(sourceManifestPath);
const sourceManifest = JSON.parse(sourceManifestBytes.toString("utf8"));
assert.equal(sourceManifest.status, "passed", "仅转换已通过验收的原始片段。");
assert.ok(Array.isArray(sourceManifest.scenarios) && sourceManifest.scenarios.length > 0, "清单没有已验收片段。");
const ids = new Set();
async function requireAbsent(path) {
  try {
    await access(path);
  } catch (error) {
    if (error.code === "ENOENT") return;
    throw error;
  }
  throw new Error(`拒绝覆盖已有文件：${path}`);
}
await requireAbsent(outputManifestPath);
for (const scenario of sourceManifest.scenarios) {
  assert.ok(typeof scenario.id === "string" && /^[A-Za-z0-9][A-Za-z0-9_-]{0,99}$/.test(scenario.id), "片段标识无效。");
  assert.ok(!ids.has(scenario.id), "片段标识重复。");
  ids.add(scenario.id);
  assert.equal(scenario.status, "passed", "清单中包含未通过的片段。");
  assert.match(scenario.metadata?.sha256 ?? "", /^[0-9a-f]{64}$/, "源视频没有已核验SHA256。");
  await requireAbsent(resolve(directory, scenario.id + ".mp4"));
}
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
const output = {
  sourceManifest: sourceManifestPath,
  sourceManifestSha256: digest(sourceManifestBytes),
  method: "real WebM playback → canvas → Chrome MediaRecorder H.264",
  status: "running",
  clips: [],
};
await writeFile(outputManifestPath, JSON.stringify(output, null, 2), { flag: "wx" });
const browser = await chromium.launch({ channel: "chrome", args: ["--disable-gpu", "--disable-frame-rate-limit"] });

try {
  const context = await browser.newContext({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
  const page = await context.newPage();
  page.setDefaultTimeout(30000);
  output.supportedTypes = await page.evaluate(() =>
    Object.fromEntries(["video/mp4;codecs=avc1.42E01E", "video/mp4;codecs=avc1", "video/mp4"].map((type) => [type, MediaRecorder.isTypeSupported(type)])),
  );
  const mimeType = Object.keys(output.supportedTypes).find((type) => type.includes("avc1") && output.supportedTypes[type]);
  if (!mimeType) {
    output.status = "unsupported";
    process.exitCode = 1;
    console.log(JSON.stringify({ status: output.status, supportedTypes: output.supportedTypes }));
  } else {
    output.mimeType = mimeType;
    for (const scenario of sourceManifest.scenarios) {
      const inputPath = resolve(directory, scenario.id + ".webm");
      const outputPath = resolve(directory, scenario.id + ".mp4");
      const sourceBytes = await readFile(inputPath);
      assert.equal(digest(sourceBytes), scenario.metadata.sha256, "源视频与已验收SHA256不符。");
      const started = Date.now();
      const clip = { id: scenario.id, input: inputPath, output: outputPath, sourceSha256: digest(sourceBytes), status: "running" };
      output.clips.push(clip);
      const encoded = await page.evaluate(
        async ({ base64, mimeType }) => {
          const source = document.createElement("video");
          source.muted = true;
          source.playsInline = true;
          document.body.append(source);
          source.src = "data:video/webm;base64," + base64;
          const event = (target, name, timeoutMs = 15000) =>
            new Promise((done, reject) => {
              const timeout = setTimeout(() => reject(new Error(name + " 超时")), timeoutMs);
              target.addEventListener(
                name,
                () => {
                  clearTimeout(timeout);
                  done();
                },
                { once: true },
              );
              target.addEventListener(
                "error",
                () => {
                  clearTimeout(timeout);
                  reject(new Error(name + " 解码错误"));
                },
                { once: true },
              );
            });
          await event(source, "loadeddata");
          if (!Number.isFinite(source.duration)) {
            const end = event(source, "seeked");
            source.currentTime = 1e10;
            await end;
          }
          const sourceDuration = source.duration;
          if (!Number.isFinite(sourceDuration) || sourceDuration <= 0) throw new Error("源视频时长无效。");
          const rewind = event(source, "seeked");
          source.currentTime = 0;
          await rewind;
          const canvas = document.createElement("canvas");
          canvas.width = source.videoWidth;
          canvas.height = source.videoHeight;
          document.body.append(canvas);
          const painter = canvas.getContext("2d", { alpha: false });
          if (!painter) throw new Error("转录画布不可用。");
          const stream = canvas.captureStream(0);
          const track = stream.getVideoTracks()[0];
          const recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 5000000 });
          const chunks = [];
          recorder.ondataavailable = ({ data }) => {
            if (data.size) chunks.push(data);
          };
          let frames = 0;
          let drawing = true;
          const draw = () => {
            if (!drawing) return;
            painter.drawImage(source, 0, 0, canvas.width, canvas.height);
            track.requestFrame();
            frames++;
            source.requestVideoFrameCallback(draw);
          };
          recorder.start(250);
          const ended = event(source, "ended", Math.ceil(sourceDuration * 1000) + 30000);
          source.requestVideoFrameCallback(draw);
          await source.play();
          await ended;
          drawing = false;
          await new Promise((done, reject) => {
            recorder.addEventListener("stop", done, { once: true });
            recorder.addEventListener("error", () => reject(new Error("MP4编码失败。")), { once: true });
            recorder.stop();
          });
          stream.getTracks().forEach((item) => item.stop());
          const blob = new Blob(chunks, { type: recorder.mimeType });
          const data = await new Promise((done, reject) => {
            const reader = new FileReader();
            reader.onload = () => (typeof reader.result === "string" ? done(reader.result.split(",")[1]) : reject(new Error("MP4导出失败。")));
            reader.onerror = reject;
            reader.readAsDataURL(blob);
          });
          source.remove();
          canvas.remove();
          return { base64: data, sourceDuration, frames, mimeType: recorder.mimeType };
        },
        { base64: sourceBytes.toString("base64"), mimeType },
      );
      const mp4 = Buffer.from(encoded.base64, "base64");
      assert.ok(mp4.length > 0);
      assert.equal(mp4.subarray(4, 8).toString("ascii"), "ftyp", "编码输出不是MP4容器。");
      assert.ok(mp4.includes(Buffer.from("avc1")) && mp4.includes(Buffer.from("avcC")), "编码输出未含H.264轨道及解码配置。");
      await writeFile(outputPath, mp4, { flag: "wx" });
      const metadata = await page.evaluate(async (base64) => {
        const video = document.createElement("video");
        video.muted = true;
        video.src = "data:video/mp4;base64," + base64;
        await new Promise((done, reject) => {
          const timeout = setTimeout(() => reject(new Error("MP4解码超时。")), 15000);
          video.onloadeddata = () => {
            clearTimeout(timeout);
            done();
          };
          video.onerror = () => {
            clearTimeout(timeout);
            reject(new Error("MP4无法解码。"));
          };
        });
        await video.play();
        await new Promise((done, reject) => {
          const timeout = setTimeout(() => reject(new Error("MP4无法播放。")), 10000);
          video.ontimeupdate = () => {
            if (video.currentTime > 0.1) {
              clearTimeout(timeout);
              done();
            }
          };
        });
        video.pause();
        const duration = video.duration;
        if (!Number.isFinite(duration) || duration <= 0) throw new Error("MP4时长无效。");
        return { width: video.videoWidth, height: video.videoHeight, durationSeconds: duration, playbackVerified: true };
      }, mp4.toString("base64"));
      assert.equal(metadata.width, scenario.metadata.width);
      assert.equal(metadata.height, scenario.metadata.height);
      assert.ok(Math.abs(metadata.durationSeconds - scenario.metadata.durationSeconds) <= 1, "转录时长偏差超过1秒。");
      assert.equal(digest(await readFile(inputPath)), clip.sourceSha256, "源视频发生变化。");
      assert.equal(digest(await readFile(outputPath)), digest(mp4), "MP4落盘摘要与编码结果不符。");
      assert.ok(encoded.frames > 0, "转码没有真实播放帧。");
      Object.assign(clip, {
        status: "passed",
        metadata,
        bytes: mp4.length,
        sha256: digest(mp4),
        sourceDuration: encoded.sourceDuration,
        encodedFrames: encoded.frames,
        mimeType: encoded.mimeType,
        codec: "H.264",
        sourcePreserved: true,
        elapsedMilliseconds: Date.now() - started,
      });
      await writeFile(outputManifestPath, JSON.stringify(output, null, 2));
      console.log(JSON.stringify({ id: clip.id, status: clip.status, output: outputPath, metadata }));
    }
    assert.equal(digest(await readFile(sourceManifestPath)), output.sourceManifestSha256, "原始录屏清单发生变化。");
    output.status = "passed";
  }
} catch (error) {
  output.status = "failed";
  output.failure = String(error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  await browser.close();
  await writeFile(outputManifestPath, JSON.stringify(output, null, 2));
  console.log(JSON.stringify({ status: output.status, manifest: outputManifestPath }));
}
