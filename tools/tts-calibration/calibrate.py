#!/usr/bin/env python
"""Generate Edge Neural TTS MP3 files and duration reports from formal Narration text exports."""

from __future__ import annotations

import argparse
import asyncio
import csv
import json
import re
import shutil
import sys
from collections import defaultdict
from pathlib import Path
from statistics import mean

import edge_tts
from mutagen.mp3 import MP3


ROOT = Path(__file__).resolve().parent
DEFAULT_INPUT = ROOT / "output" / "narration-texts.json"
DEFAULT_OUTPUT = ROOT / "output"
LANGUAGES = ("zh-CN", "en-US")
CSV_FIELDS = [
    "narrationAction", "narrationId", "language", "segment", "text", "voice", "audioFile",
    "durationSeconds", "durationMs", "currentDurationMs", "currentPostGapMs", "status", "error",
]


def safe_name(value: str) -> str:
    return re.sub(r"[^A-Za-z0-9._-]+", "-", value).strip("-")


def select_voices(voices: list[dict], locale: str) -> list[str]:
    candidates = sorted(
        (voice for voice in voices if voice.get("Locale") == locale and voice.get("ShortName", "").endswith("Neural")),
        key=lambda voice: voice["ShortName"],
    )
    if len(candidates) < 2:
        raise RuntimeError(f"Edge TTS returned fewer than two {locale} Neural voices")

    # Prefer ordinary General/News/Narration voices over Cartoon variants, without relying on fixed voice IDs.
    category_rank = {"General": 0, "News": 1, "Novel": 2, "Conversation": 3, "Sports": 4, "Cartoon": 10, "Dialect": 11}
    def priority(voice: dict) -> tuple[int, str]:
        categories = voice.get("VoiceTag", {}).get("ContentCategories", [])
        return (min((category_rank.get(category, 5) for category in categories), default=5), voice["ShortName"])

    female = min((voice for voice in candidates if voice.get("Gender") == "Female"), key=priority, default=None)
    male = min((voice for voice in candidates if voice.get("Gender") == "Male"), key=priority, default=None)
    selected = [voice for voice in (female, male) if voice]
    for voice in sorted(candidates, key=priority):
        if len(selected) == 2:
            break
        if voice not in selected:
            selected.append(voice)
    return [voice["ShortName"] for voice in selected]


async def synthesize(record: dict, voice: str, output_file: Path) -> tuple[float, int]:
    output_file.parent.mkdir(parents=True, exist_ok=True)
    communicate = edge_tts.Communicate(record["text"], voice=voice, rate="+0%", pitch="+0Hz", volume="+0%")
    await communicate.save(str(output_file))
    if not output_file.is_file() or output_file.stat().st_size <= 0:
        raise RuntimeError("generated audio file is missing or empty")
    duration_seconds = MP3(output_file).info.length
    if duration_seconds <= 0:
        raise RuntimeError("MP3 duration is not positive")
    return duration_seconds, round(duration_seconds * 1000)


def write_csv(path: Path, rows: list[dict], fields: list[str]) -> None:
    with path.open("w", encoding="utf-8-sig", newline="") as file:
        writer = csv.DictWriter(file, fieldnames=fields, extrasaction="ignore")
        writer.writeheader()
        writer.writerows(rows)


def summary_rows(records: list[dict], raw_rows: list[dict], voices_by_language: dict[str, list[str]]) -> list[dict]:
    measurements: dict[tuple, list[dict]] = defaultdict(list)
    for row in raw_rows:
        if row["status"] == "success":
            measurements[(row["narrationId"], row["language"], int(row["segment"]))].append(row)

    result = []
    for record in records:
        key = (record["narrationId"], record["language"], int(record["segment"]))
        matched = measurements[key]
        row = {
            **record,
            "voice1": voices_by_language[record["language"]][0],
            "voice1DurationMs": "",
            "voice2": voices_by_language[record["language"]][1],
            "voice2DurationMs": "",
            "minDurationMs": "",
            "maxDurationMs": "",
            "averageDurationMs": "",
            "deltaVsCurrentMs": "",
            "status": "failed" if len(matched) != 2 else "success",
        }
        by_voice = {item["voice"]: item for item in matched}
        for number, voice in enumerate(voices_by_language[record["language"]], start=1):
            if voice in by_voice:
                row[f"voice{number}DurationMs"] = by_voice[voice]["durationMs"]
        if len(matched) == 2:
            durations = [int(item["durationMs"]) for item in matched]
            row["minDurationMs"] = min(durations)
            row["maxDurationMs"] = max(durations)
            row["averageDurationMs"] = round(mean(durations))
            row["deltaVsCurrentMs"] = row["maxDurationMs"] - int(record["currentDurationMs"])
        result.append(row)
    return result


def markdown_report(summary: list[dict], voices_by_language: dict[str, list[str]], raw_rows: list[dict]) -> str:
    ordered_ids = ["parkRealtimeNarration", "securityRealtimeNarration", "energyRealtimeNarration", "parkBaseOverview"]
    title_by_id = {
        "parkRealtimeNarration": "综合运行态势",
        "securityRealtimeNarration": "安防实时态势",
        "energyRealtimeNarration": "能源与能效实时态势",
        "parkBaseOverview": "园区基础底数",
    }
    lines = [
        "# Narration Edge TTS 本地时长标定",
        "",
        "- 引擎：Edge Neural TTS",
        "- 语速：`+0%`；音高：`+0Hz`；音量：`+0%`",
        f"- 中文 voices：{', '.join(voices_by_language['zh-CN'])}",
        f"- 英文 voices：{', '.join(voices_by_language['en-US'])}",
        "- 文本由 `src/narration/narration-definitions.js` 直接导出；本报告不修改生产参数。",
    ]
    for language, label in (("zh-CN", "中文"), ("en-US", "英文")):
        voice_a, voice_b = voices_by_language[language]
        for narration_id in ordered_ids:
            rows = [row for row in summary if row["language"] == language and row["narrationId"] == narration_id]
            if not rows:
                continue
            lines.extend([
                "",
                f"## {label}——{title_by_id[narration_id]}",
                "",
                f"| Step | 当前 duration (ms) | {voice_a} (ms) | {voice_b} (ms) | 最大值 (ms) | 与当前差值 (ms) |",
                "| ---: | ---: | ---: | ---: | ---: | ---: |",
            ])
            for row in sorted(rows, key=lambda item: int(item["segment"])):
                lines.append(
                    f"| {row['segment']} | {row['currentDurationMs']} | {row['voice1DurationMs']} | "
                    f"{row['voice2DurationMs']} | {row['maxDurationMs']} | {row['deltaVsCurrentMs']} |"
                )

    lines.extend(["", "## 语言整体统计", ""])
    for language, label in (("zh-CN", "中文"), ("en-US", "英文")):
        rows = [row for row in summary if row["language"] == language and row["status"] == "success"]
        max_average = round(mean(int(row["maxDurationMs"]) for row in rows))
        current_average = round(mean(int(row["currentDurationMs"]) for row in rows))
        lines.append(f"- {label}：maxDurationMs 平均值 {max_average} ms；当前 durationMs 平均值 {current_average} ms；平均差值 {max_average - current_average} ms。")

    failures = [row for row in raw_rows if row["status"] != "success"]
    lines.extend(["", "## 完整性", "", f"- 目标文本：32", f"- 目标音频：64", f"- 成功：{len(raw_rows) - len(failures)}", f"- 失败：{len(failures)}"])
    if failures:
        lines.extend(["", "| Narration | 语言 | Step | Voice | 错误 |", "| --- | --- | ---: | --- | --- |"])
        for row in failures:
            lines.append(f"| {row['narrationAction']} | {row['language']} | {row['segment']} | {row['voice']} | {row['error']} |")
    return "\n".join(lines) + "\n"


async def calibrate(input_file: Path, output_dir: Path, force: bool) -> int:
    records = json.loads(input_file.read_text(encoding="utf-8"))
    if len(records) != 32:
        raise RuntimeError(f"expected 32 formal narration texts, received {len(records)}")
    if {record["language"] for record in records} != set(LANGUAGES):
        raise RuntimeError("formal export must contain zh-CN and en-US text")

    voices = await edge_tts.list_voices()
    voices_by_language = {language: select_voices(voices, language) for language in LANGUAGES}
    output_dir.mkdir(parents=True, exist_ok=True)
    (output_dir / "edge-tts-voices.json").write_text(json.dumps(voices_by_language, indent=2) + "\n", encoding="utf-8")

    raw_rows = []
    for record in records:
        for voice in voices_by_language[record["language"]]:
            filename = f"step{record['segment']}_{safe_name(voice)}.mp3"
            audio_file = output_dir / record["language"] / record["narrationId"] / filename
            row = {**record, "voice": voice, "audioFile": str(audio_file.relative_to(output_dir)), "status": "success", "error": ""}
            try:
                if force and audio_file.exists():
                    audio_file.unlink()
                duration_seconds, duration_ms = await synthesize(record, voice, audio_file)
                row["durationSeconds"] = f"{duration_seconds:.3f}"
                row["durationMs"] = duration_ms
                print(f"OK {record['language']} {record['narrationId']} step{record['segment']} {voice}: {duration_ms} ms")
            except Exception as error:  # Keep every requested voice in the output for auditable failures.
                row["status"] = "failed"
                row["error"] = str(error)
                row["durationSeconds"] = ""
                row["durationMs"] = ""
                print(f"FAILED {record['language']} {record['narrationId']} step{record['segment']} {voice}: {error}", file=sys.stderr)
            raw_rows.append(row)

    summary = summary_rows(records, raw_rows, voices_by_language)
    write_csv(output_dir / "narration-tts-calibration.csv", raw_rows, CSV_FIELDS)
    summary_fields = [
        "narrationAction", "narrationId", "language", "segment", "text", "currentDurationMs", "currentPostGapMs",
        "voice1", "voice1DurationMs", "voice2", "voice2DurationMs", "minDurationMs", "maxDurationMs",
        "averageDurationMs", "deltaVsCurrentMs", "status",
    ]
    write_csv(output_dir / "narration-tts-calibration-summary.csv", summary, summary_fields)
    (output_dir / "narration-tts-calibration.json").write_text(
        json.dumps({"engine": "Edge Neural TTS", "rate": "+0%", "pitch": "+0Hz", "volume": "+0%", "voices": voices_by_language, "records": raw_rows, "summary": summary}, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    (output_dir / "narration-tts-calibration.md").write_text(markdown_report(summary, voices_by_language, raw_rows), encoding="utf-8")

    failures = [row for row in raw_rows if row["status"] != "success"]
    print(f"Completed: formal texts=32, target audio=64, success={len(raw_rows) - len(failures)}, failed={len(failures)}")
    return 1 if failures else 0


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", type=Path, default=DEFAULT_INPUT)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--force", action="store_true", help="regenerate audio if it exists")
    args = parser.parse_args()
    if not args.input.is_file():
        parser.error(f"input does not exist: {args.input}; run extract-narration-texts.js first")
    return asyncio.run(calibrate(args.input, args.output, args.force))


if __name__ == "__main__":
    raise SystemExit(main())
