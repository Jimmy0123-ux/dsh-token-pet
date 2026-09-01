"""Verify H3 v04 action videos and build first/middle/last QA contact sheets."""
from pathlib import Path
import json
import os
import subprocess

import numpy as np
from PIL import Image, ImageDraw

ROOT = Path(r"H:\ds\dsh-token-pet")
ACTION_ROOT = ROOT / "Review/h3-actions"
VERSION = os.environ.get("H3_VERIFY_VERSION", "v04")
QA_LABEL = os.environ.get("H3_QA_LABEL", f"qa-{VERSION}-batch")
QA_ROOT = ACTION_ROOT / QA_LABEL
QA_ROOT.mkdir(parents=True, exist_ok=True)
ACTIONS = [
    "idle", "working", "eating", "digesting", "warning", "evolve",
    "click", "archive", "tool-success", "tool-failure",
    "prompt-enhancing", "prompt-ready",
]


def probe(path: Path):
    result = subprocess.run([
        "ffprobe", "-v", "error", "-show_entries",
        "format=duration,size", "-show_entries",
        "stream=index,codec_type,codec_name,width,height,r_frame_rate,nb_frames",
        "-of", "json", str(path),
    ], capture_output=True, text=True, timeout=60)
    if result.returncode != 0:
        raise RuntimeError(result.stderr)
    return json.loads(result.stdout)


def extract(path: Path, action: str, duration: float):
    times = [0.0, max(0.0, duration / 2), max(0.0, duration - 0.08)]
    outputs = []
    for label, timestamp in zip(("first", "middle", "last"), times):
        target = QA_ROOT / f"{action}-{label}.png"
        result = subprocess.run([
            "ffmpeg", "-y", "-v", "error", "-ss", f"{timestamp:.4f}",
            "-i", str(path), "-frames:v", "1", str(target),
        ], capture_output=True, text=True, timeout=90)
        if result.returncode != 0 or not target.exists():
            raise RuntimeError(f"extract failed {action}/{label}: {result.stderr}")
        outputs.append(target)
    return outputs


def background_stats(path: Path):
    arr = np.array(Image.open(path).convert("RGB"), dtype=np.float32)
    border = np.concatenate([
        arr[:24].reshape(-1, 3), arr[-24:].reshape(-1, 3),
        arr[:, :24].reshape(-1, 3), arr[:, -24:].reshape(-1, 3),
    ])
    return {
        "meanRgb": [round(float(v), 2) for v in border.mean(axis=0)],
        "stdRgb": [round(float(v), 2) for v in border.std(axis=0)],
    }


report = {"version": VERSION, "actions": {}, "ok": True, "problems": []}
rows = []
for action in ACTIONS:
    video = ACTION_ROOT / action / f"{action}-{VERSION}-nosr.mp4"
    if not video.exists():
        report["ok"] = False
        report["problems"].append(f"missing {video}")
        continue
    tech = probe(video)
    streams = tech.get("streams", [])
    vstream = next((s for s in streams if s.get("codec_type") == "video"), {})
    duration = float(tech.get("format", {}).get("duration", 0) or 0)
    valid = (
        vstream.get("codec_name") == "h264"
        and vstream.get("width") == 864
        and vstream.get("height") == 480
        and vstream.get("r_frame_rate") == "24/1"
        and duration > 0
    )
    if not valid:
        report["ok"] = False
        report["problems"].append(f"bad technical spec: {action}")
    frames = extract(video, action, duration)
    bg = [background_stats(p) for p in frames]
    report["actions"][action] = {
        "video": str(video),
        "bytes": video.stat().st_size,
        "duration": duration,
        "videoStream": vstream,
        "qaFrames": [str(p) for p in frames],
        "background": bg,
        "technicalOk": valid,
    }
    rows.append((action, frames))

# Four contact sheets, 3 actions per sheet, first/middle/last columns.
for group_index in range(0, len(rows), 3):
    group = rows[group_index:group_index + 3]
    cell_w, cell_h, label_h = 432, 240, 30
    sheet = Image.new("RGB", (cell_w * 3, (cell_h + label_h) * len(group)), (30, 30, 30))
    draw = ImageDraw.Draw(sheet)
    for row_index, (action, frames) in enumerate(group):
        y = row_index * (cell_h + label_h)
        for col_index, (label, frame_path) in enumerate(zip(("first", "middle", "last"), frames)):
            image = Image.open(frame_path).convert("RGB").resize((cell_w, cell_h), Image.Resampling.LANCZOS)
            x = col_index * cell_w
            sheet.paste(image, (x, y + label_h))
            draw.text((x + 8, y + 7), f"{action} / {label}", fill=(255, 255, 255))
    sheet.save(QA_ROOT / f"contact-{group_index // 3 + 1}.jpg", quality=92)

(QA_ROOT / "technical-report.json").write_text(
    json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8"
)
print(json.dumps({
    "ok": report["ok"],
    "problems": report["problems"],
    "actions": len(report["actions"]),
    "contacts": [str(p) for p in sorted(QA_ROOT.glob("contact-*.jpg"))],
    "report": str(QA_ROOT / "technical-report.json"),
}, ensure_ascii=False, indent=2))
