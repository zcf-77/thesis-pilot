"""为已通过的真实录屏生成中文配音、同步字幕和 4K MP4。"""

from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import wave

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_VOICE = "Microsoft Huihui Desktop"
NARRATION = {
    "01-writing-history": "在毕设智途中，从空白项目开始写作。保存、查看历史，并在刷新后恢复同一份正式稿。",
    "02-structure-task": "结构检查绑定已保存的正文版本。后续草稿不混入任务，执行结果可以刷新恢复。",
    "03-conflict-recovery": "两个窗口同时编辑时，系统用版本检查阻止旧稿覆盖。原草稿被保留，可核对新版本后恢复。",
    "04-configurations": "配置台管理接口、模型、提示词和智能体的固定版本。这里的试跑只做确定性模板渲染，没有调用模型，也没有写入正文。",
    "05-materials": "上传自制 Word 原件后，系统保存原包并执行真实解析。公式和未知对象明确保留，下载原件可核对字节与摘要。",
    "06-document-source": "从固定原件导入时，可先校正章节，再创建正式稿。每个历史版本都保留来源和保护映射。",
    "07-content-assistant": "内容助手固定选区、目标和配置。没有模型凭据时会明确失败，保留原消息与重试入口，不生成虚假候选。",
    "08-task-feedback": "任务关联真实产物版本和导师反馈。学生核对后确认处理，返工或撤销都保留历史。",
    "09-safe-format": "格式修改先形成可审阅候选。程序检查通过后由学生采纳，撤销和过期保护保持正文可追溯。",
}


def run(command: list[str], cwd: Path | None = None, env: dict[str, str] | None = None) -> subprocess.CompletedProcess[str]:
    result = subprocess.run(command, cwd=cwd, env=env, text=True, capture_output=True)
    if result.returncode:
        raise RuntimeError(f"命令退出 {result.returncode}：{command[0]}\n{result.stderr[-2000:]}")
    return result


def tool(name: str) -> str:
    configured = os.environ.get(f"TP_{name.upper()}")
    if configured:
        return configured
    installed = shutil.which(name)
    if installed:
        return installed
    candidate = ROOT / "work/tools/ffmpeg/ffmpeg-master-latest-win64-gpl/bin" / f"{name}.exe"
    if candidate.is_file():
        return str(candidate)
    raise RuntimeError(f"缺少 {name}；请安装，或用 TP_{name.upper()} 指定工作区内工具。")


def probe(path: Path) -> dict:
    return json.loads(run([tool("ffprobe"), "-v", "error", "-show_format", "-show_streams", "-of", "json", str(path)]).stdout)


def duration(path: Path) -> float:
    value = float(probe(path)["format"]["duration"])
    if value <= 0:
        raise ValueError(f"{path.name} 没有有效时长")
    return value


def srt_time(seconds: float) -> str:
    millis = max(0, round(seconds * 1000))
    hours, millis = divmod(millis, 3_600_000)
    minutes, millis = divmod(millis, 60_000)
    seconds, millis = divmod(millis, 1000)
    return f"{hours:02d}:{minutes:02d}:{seconds:02d},{millis:03d}"


def synthesize(text: str, output: Path, voice: str) -> None:
    if os.name != "nt":
        raise RuntimeError("当前中文配音使用 Windows 本机语音；其他系统请提供已生成的配音。")
    command = (
        "Add-Type -AssemblyName System.Speech; "
        "$speaker=New-Object System.Speech.Synthesis.SpeechSynthesizer; "
        "$speaker.SelectVoice($env:TP_NARRATION_VOICE); "
        "$speaker.Rate=0; "
        "$speaker.SetOutputToWaveFile($env:TP_NARRATION_OUT); "
        "$speaker.Speak($env:TP_NARRATION_TEXT); "
        "$speaker.Dispose()"
    )
    env = dict(os.environ, TP_NARRATION_TEXT=text, TP_NARRATION_OUT=str(output), TP_NARRATION_VOICE=voice)
    run(["powershell.exe", "-NoProfile", "-Command", command], env=env)


def narration(scene: dict, directory: Path, voice: str) -> dict:
    text = NARRATION.get(scene["id"], f"{scene['title']}。本段保留页面中的真实操作、状态和恢复路径。")
    parts = [part.strip() for part in re.findall(r"[^。！？]+[。！？]?", text) if part.strip()]
    if not parts:
        raise ValueError("配音文本为空")
    directory.mkdir(parents=True, exist_ok=True)
    segments = []
    combined = directory / "narration.wav"
    writer = None
    params = None
    cursor = 0.2
    entries = []
    try:
        for index, part in enumerate(parts):
            source = directory / f"voice-{index + 1}.wav"
            synthesize(part, source, voice)
            with wave.open(str(source), "rb") as reader:
                current = reader.getparams()
                frames = reader.readframes(reader.getnframes())
                rate = reader.getframerate()
            if params is not None and (current.nchannels, current.sampwidth, current.framerate) != params:
                raise ValueError("同一讲述的语音格式不一致")
            params = (current.nchannels, current.sampwidth, current.framerate)
            if writer is None:
                writer = wave.open(str(combined), "wb")
                writer.setnchannels(current.nchannels)
                writer.setsampwidth(current.sampwidth)
                writer.setframerate(current.framerate)
            if index == 0:
                writer.writeframes(b"\x00" * int(rate * 0.2) * current.nchannels * current.sampwidth)
            else:
                pause = int(rate * 0.12) * current.nchannels * current.sampwidth
                writer.writeframes(b"\x00" * pause)
                cursor += 0.12
            writer.writeframes(frames)
            length = len(frames) / (rate * current.nchannels * current.sampwidth)
            entries.append({"text": part, "start": cursor, "end": cursor + length})
            cursor += length
            segments.append({"text": part, "duration": length})
    finally:
        if writer is not None:
            writer.close()
    if not params:
        raise ValueError("没有生成语音")
    if not any(byte != 0 for byte in combined.read_bytes()[44:]):
        raise ValueError("中文配音是空白音轨")
    content = "\n\n".join(f"{index}\n{srt_time(item['start'])} --> {srt_time(item['end'])}\n{item['text']}" for index, item in enumerate(entries, 1)) + "\n"
    (directory / "subtitles.srt").write_text(content, encoding="utf-8-sig")
    return {"text": text, "segments": segments, "entries": entries, "duration": cursor, "file": combined, "srt": directory / "subtitles.srt"}


def render(scene: dict, source_directory: Path, output: Path, voice: str) -> dict:
    source = Path(scene.get("video", ""))
    if not source.is_file():
        source = source_directory / f"{scene['id']}.webm"
    if not source.is_file():
        raise FileNotFoundError(f"缺少场景视频：{source}")
    metadata = scene.get("metadata") or {}
    if metadata.get("width") != 3840 or metadata.get("height") != 2160:
        raise ValueError(f"{scene['id']} 不是已验证的 3840×2160 视频")
    source_info = probe(source)
    source_duration = float(source_info["format"]["duration"])
    work = output / scene["id"]
    work.mkdir(parents=True, exist_ok=True)
    narrated = narration(scene, work / "voice", voice)
    target = max(source_duration, narrated["duration"] + 0.4)
    padding = max(0, target - source_duration)
    destination = output / f"{scene['id']}.mp4"
    video_filter = f"tpad=stop_mode=clone:stop_duration={padding:.3f},subtitles=subtitles.srt:force_style='FontName=Microsoft YaHei,FontSize=18,PrimaryColour=&H00FFFFFF,OutlineColour=&H80000000,BackColour=&H80000000,BorderStyle=3,Outline=1,MarginV=20'"
    command = [
        tool("ffmpeg"), "-hide_banner", "-loglevel", "warning", "-y",
        "-i", str(source), "-i", str(narrated["file"]),
        "-filter_complex", f"[0:v]{video_filter}[v]",
        "-map", "[v]", "-map", "1:a:0",
        "-c:v", "libx264", "-preset", "medium", "-crf", "19", "-pix_fmt", "yuv420p", "-r", "20",
        "-c:a", "aac", "-b:a", "160k", "-ar", "48000",
        "-af", f"apad=whole_dur={target:.3f}",
        "-t", f"{target:.3f}", "-metadata", f"title={scene['title']}", str(destination),
    ]
    run(command, cwd=work / "voice")
    info = probe(destination)
    video = next(stream for stream in info["streams"] if stream["codec_type"] == "video")
    audio = next(stream for stream in info["streams"] if stream["codec_type"] == "audio")
    if (video.get("width"), video.get("height")) != (3840, 2160) or audio.get("codec_name") != "aac":
        raise ValueError(f"{scene['id']} 成片尺寸或音轨不符")
    actual = float(info["format"]["duration"])
    if abs(actual - target) > 0.5:
        raise ValueError(f"{scene['id']} 成片时长不符")
    return {
        "id": scene["id"], "title": scene["title"], "source": str(source), "output": str(destination),
        "duration": actual, "width": 3840, "height": 2160, "audioCodec": "aac", "narration": narrated["text"],
        "subtitleEntries": narrated["entries"], "status": "passed",
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("directory", help="已通过验收的 capture-competition manifest 所在目录")
    parser.add_argument("--voice", default=DEFAULT_VOICE)
    parser.add_argument("--output", help="新的成片目录；默认使用源目录下 production")
    args = parser.parse_args()
    source_directory = Path(args.directory).resolve()
    source_manifest_path = source_directory / "manifest.json"
    output = Path(args.output).resolve() if args.output else source_directory / "production"
    if output.exists():
        raise FileExistsError(f"拒绝覆盖已有成片目录：{output}")
    output.mkdir(parents=True)
    production = {"status": "running", "sourceManifest": str(source_manifest_path), "voice": args.voice, "scenarios": []}
    production_path = output / "production-manifest.json"
    production_path.write_text(json.dumps(production, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    try:
        source = json.loads(source_manifest_path.read_text(encoding="utf-8"))
        if source.get("status") != "passed" or not source.get("scenarios"):
            raise ValueError("只有整体通过且含场景的真实录屏才能合成")
        for scene in source["scenarios"]:
            if scene.get("status") != "passed":
                raise ValueError(f"场景 {scene.get('id')} 未通过，拒绝剪成成功")
            rendered = render(scene, source_directory, output, args.voice)
            production["scenarios"].append(rendered)
            production_path.write_text(json.dumps(production, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
            print(json.dumps({"id": rendered["id"], "status": "passed", "duration": rendered["duration"]}, ensure_ascii=False), flush=True)
        concat = output / "concat.txt"
        concat.write_text("".join(f"file '{scene['id']}.mp4'\n" for scene in production["scenarios"]), encoding="utf-8")
        final = output / "thesis-pilot-4k.mp4"
        run([tool("ffmpeg"), "-hide_banner", "-loglevel", "warning", "-y", "-f", "concat", "-safe", "0", "-i", concat.name, "-c", "copy", str(final)], cwd=output)
        final_duration = duration(final)
        offset = 0.0
        subtitles = []
        sequence = 1
        for scene in production["scenarios"]:
            for entry in scene["subtitleEntries"]:
                subtitles.append(f"{sequence}\n{srt_time(offset + entry['start'])} --> {srt_time(offset + entry['end'])}\n{entry['text']}")
                sequence += 1
            offset += scene["duration"]
        srt_path = output / "thesis-pilot-4k.srt"
        srt_path.write_text("\n\n".join(subtitles) + "\n", encoding="utf-8-sig")
        info = probe(final)
        if not any(stream["codec_type"] == "audio" for stream in info["streams"]):
            raise ValueError("最终成片没有音轨")
        production.update({
            "status": "passed", "video": str(final), "subtitles": str(srt_path), "duration": final_duration,
            "width": 3840, "height": 2160, "audio": True, "hardSubtitles": True, "sourcePreserved": True,
        })
    except Exception as error:
        production.update({"status": "failed", "failure": str(error)})
        production_path.write_text(json.dumps(production, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        raise
    production_path.write_text(json.dumps(production, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"status": "passed", "video": production["video"], "subtitles": production["subtitles"], "duration": final_duration}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception as error:
        print(f"FAIL: {error}", file=sys.stderr)
        sys.exit(1)
