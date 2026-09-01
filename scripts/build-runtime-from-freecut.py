"""Runtime strips from the user's re-cut zips, feet-anchored and size-unified.

Frame source : <action>/免费在线抠图-*.zip (user transparency, PNG frames)
Normalization: one GLOBAL scale from the idle body height (feetMedian -
               topMedian -> 480 px), identical for every action; per-frame
               feet baseline anchored to a fixed cell line (median feet ->
               FEET_Y), preserving real motion like click's bounce; effects
               (rings, sparkles) keep their true size because the scale never
               depends on effect bounding boxes.
Stable anchor: ONE fixed horizontal anchor per action — the median of the
               per-frame bottom-body centers (bottom 60% of content height).
               Every frame places that SAME absolute source x on the cell
               center, so the source frames' own horizontal motion (sway,
               steps, wobble) survives instead of being cancelled per frame.
Cell sizing  : per-action width grows from the fixed anchor to the farthest
               left/right content boundary across ALL frames, doubled around
               the center + 16 px padding (clamped), so wide effects are
               never clipped; height fixed 540 with 20 px below the feet line.
Runtime      : pet.tsx anchors the player so the feet line sits exactly on the
               container bottom, so the stage chip below never covers the feet.
"""
from pathlib import Path
import base64
import io
import json
import shutil
import subprocess
import tempfile
import time

import numpy as np
from PIL import Image

ROOT = Path(r"H:\ds\dsh-token-pet")
ACTION_ROOT = ROOT / "Review/h3-actions"
OUT_TS = ROOT / "src/client/pet-action-sheets.generated.ts"
STRIP_OUT = ROOT / "assets/pet/action-sheets"   # per-action composite WebP files
REPORT = ROOT / "Review/h3-actions/webp-compression-report.json"

TARGET_H = 480            # body height in the cell (1.5x of the old 320: crisp on 2x displays)
FRAME_H = 540             # cell height (360 * 1.5)
FEET_Y = 520              # feet baseline inside the cell
MIN_W = 360               # min cell width (240 * 1.5)
MAX_W = 660               # max cell width (440 * 1.5; eating particles stay uncropped)
SAMPLE = 32
# Playback is unified to the idle baseline: every action steps at exactly
# 100 ms/frame (10 fps). 32 frames come from ~3s@24fps video (~94 ms/frame),
# so 100 ms stays at natural pace and all 12 actions share one speed.
FRAME_DELAY_MS = 100
DELAYS = {action: FRAME_DELAY_MS for action in [
    "idle", "working", "eating", "digesting", "warning", "evolve",
    "click", "archive", "tool-success", "tool-failure", "prompt-enhancing",
    "prompt-ready",
]}
LOOPS = {
    "idle": True, "working": True, "warning": True, "prompt-enhancing": True,
    "eating": False, "digesting": False, "evolve": False, "click": False,
    "archive": False, "tool-success": False, "tool-failure": False,
    "prompt-ready": False,
}
# Ping-pong playback: the player walks the frame list forwards then backwards
# for a seamless round-trip. Only prompt-enhancing is authored that way (its
# spinner-style motion reverses cleanly); every other action ends where the
# source frames end and must not reverse.
PING_PONG = {
    "idle": False, "working": False, "warning": False,
    "eating": False, "digesting": False, "evolve": False, "click": False,
    "archive": False, "tool-success": False, "tool-failure": False,
    "prompt-enhancing": True,
    "prompt-ready": False,
}


def find_zip(action_dir: Path) -> Path:
    cands = sorted(action_dir.glob("免费在线抠图-*.zip"))
    if not cands:
        raise SystemExit(f"no free-cutout zip in {action_dir}")
    return cands[-1]


def extract_frames(zip_path: Path, work: Path) -> list[Path]:
    dest = work / zip_path.stem
    if dest.exists():
        shutil.rmtree(dest)
    subprocess.run(["powershell", "-NoProfile", "-Command",
                    f"Expand-Archive -LiteralPath '{zip_path}' -DestinationPath '{dest}' -Force"],
                   check=True, timeout=300)
    frames = sorted(dest.rglob("matte_*.png")) or sorted(dest.rglob("*.png"))
    if not frames:
        raise SystemExit(f"no frames in {zip_path}")
    return frames


def compress(frames: list[Path], out_dir: Path) -> tuple[int, int]:
    png_bytes = webp_bytes = 0
    out_dir.mkdir(parents=True, exist_ok=True)
    for old in out_dir.glob("*.webp"):
        for attempt in range(6):
            try:
                old.unlink()
                break
            except PermissionError:
                time.sleep(1 + attempt)
        else:
            old.unlink(missing_ok=True)
    for frame in frames:
        target = out_dir / (frame.stem + ".webp")
        Image.open(frame).convert("RGBA").save(target, "WEBP", quality=90, method=6)
        png_bytes += frame.stat().st_size
        webp_bytes += target.stat().st_size
    return png_bytes, webp_bytes


def sample(paths: list[Path], count: int) -> list[Path]:
    if len(paths) <= count:
        return paths
    idxs = [round(i * (len(paths) - 1) / (count - 1)) for i in range(count)]
    seen, picked = set(), []
    for i in idxs:
        if i not in seen:
            seen.add(i)
            picked.append(paths[i])
    return picked


def frame_boxes(frames: list[Image.Image]) -> list[tuple[int, int, int, int]]:
    boxes = []
    for f in frames:
        a = np.array(f)[:, :, 3]
        ys, xs = np.where(a > 16)
        if len(xs) == 0:
            boxes.append((0, 0, 1, 1))
            continue
        boxes.append((int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1))
    return boxes


def bottom_body_anchors(frames: list[Image.Image]) -> list[float]:
    """Per-frame center of the BODY region (bottom 60% of content height).

    Effects (sparkles, halos, particles) often sit above or beside the body and
    skew the full bounding-box center, so per-frame BODY centers are measured
    only to derive ONE stable anchor per action (their median). The anchor is
    NOT used to re-center each frame — see build_strip.
    """
    centers = []
    for f in frames:
        a = np.array(f)[:, :, 3]
        ys, xs = np.where(a > 16)
        if len(xs) == 0:
            centers.append(0.0)
            continue
        ymin, ymax = int(ys.min()), int(ys.max())
        span = max(1, ymax - ymin)
        body = ys >= ymin + 0.4 * span
        bx = xs[body]
        centers.append((float(bx.min()) + float(bx.max())) / 2)
    return centers


def build_strip(action: str, webp_paths: list[Path], scale: float, anchor_x: float) -> dict:
    frames = [Image.open(p).convert("RGBA") for p in webp_paths]
    boxes = frame_boxes(frames)
    feet = [b[3] for b in boxes]
    median_feet = float(np.median(feet))
    # Cell width must cover the FIXED anchor on BOTH sides: measure the
    # farthest distance from the anchor to any frame's left/right content
    # boundary across ALL frames, double it around the cell center and add
    # padding, so the body plus asymmetric effects (sparkles, particles) are
    # never clipped — while the anchor stays at the cell center.
    max_side = max(
        (max(anchor_x - b[0], b[2] - anchor_x) for b in boxes),
        default=1.0)
    frame_w = max(MIN_W, min(MAX_W, round(2 * max_side * scale) + 16))

    strip = Image.new("RGBA", (frame_w * len(frames), FRAME_H), (0, 0, 0, 0))
    # WebP hard limit is 16383 px per side; very wide effect cells (eating)
    # must wrap onto multiple rows. Layout is recorded in cols/rows so the
    # runtime player can pick the right source rect per frame.
    cols = len(frames)
    rows = 1
    while frame_w * cols > 16383:
        rows += 1
        cols = (len(frames) + rows - 1) // rows
    if rows > 1:
        strip = Image.new("RGBA", (frame_w * cols, FRAME_H * rows), (0, 0, 0, 0))
    for i, (f, box, foot) in enumerate(zip(frames, boxes, feet)):
        crop = f.crop(box)
        w = max(1, round(crop.width * scale))
        h = max(1, round(crop.height * scale))
        crop = crop.resize((w, h), Image.Resampling.LANCZOS)
        # Feet anchored: median feet maps to FEET_Y; real per-frame offsets
        # (bounces, steps) stay as genuine motion. Horizontal: the SAME fixed
        # source anchor_x lands on the cell center for EVERY frame, so the
        # source frames' original horizontal motion is preserved (no per-frame
        # re-centering that would cancel the character's own sway/steps).
        px = int(round(frame_w / 2 - (anchor_x - box[0]) * scale))
        py = int(round(FEET_Y - (median_feet - box[1]) * scale))
        px = max(0, min(frame_w - w, px))
        py = max(0, min(FRAME_H - h, py))
        col = i % cols
        row = i // cols
        strip.alpha_composite(crop, (col * frame_w + px, row * FRAME_H + py))
    buf = io.BytesIO()
    strip.save(buf, "WEBP", quality=90, method=6)
    file_name = f"{action}.webp"
    STRIP_OUT.mkdir(parents=True, exist_ok=True)
    (STRIP_OUT / file_name).write_bytes(buf.getvalue())
    return {
        "action": action,
        "file": file_name,
        "frames": len(frames),
        "cols": cols,
        "rows": rows,
        "b64": base64.b64encode(buf.getvalue()).decode("ascii"),
        "stripKB": len(buf.getvalue()) // 1024,
        "frameW": frame_w,
        "delay": DELAYS[action],
        "loop": LOOPS[action],
        "pingPong": PING_PONG[action],
    }


def main():
    work = Path(tempfile.mkdtemp(prefix="free-cutout-"))
    compress_report = {"source": "免费在线抠图 zips (feet-anchored)", "quality": 90,
                       "actions": {}, "startedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ")}
    prepared = {}
    try:
        # Pass 1: extract + compress + measure. Reuse the per-frame webp dir
        # when it is fresher than the zip (iterative rebuilds skip the slow
        # Expand-Archive + PNG->WebP pass entirely).
        for action in sorted(LOOPS):
            action_dir = ACTION_ROOT / action
            zip_path = find_zip(action_dir)
            webp_dir = action_dir / "transparent_frames_webp"
            webp_files = sorted(webp_dir.glob("matte_*.webp"))
            fresh = bool(webp_files) and max(p.stat().st_mtime for p in webp_files) >= zip_path.stat().st_mtime
            if fresh:
                png_bytes, webp_bytes = 0, sum(p.stat().st_size for p in webp_files)
            else:
                frames = extract_frames(zip_path, work)
                png_bytes, webp_bytes = compress(frames, webp_dir)
            images = [Image.open(p).convert("RGBA") for p in sorted(webp_dir.glob("matte_*.webp"))]
            boxes = frame_boxes(images)
            feet = [b[3] for b in boxes]
            tops = [b[1] for b in boxes]
            anchors = bottom_body_anchors(images)
            # ONE fixed stable anchor per action: the median of the per-frame
            # bottom-body centers. Empty frames report 0.0 and are excluded so
            # they cannot drag the anchor toward the left edge.
            contentful = [a for a in anchors if a > 0]
            anchor_x = float(np.median(contentful)) if contentful else 0.0
            prepared[action] = {
                "paths": sorted(webp_dir.glob("matte_*.webp")),
                "feetMedian": float(np.median(feet)),
                "topMedian": float(np.median(tops)),
                "anchorX": anchor_x,
                "unionW": max(b[2] - b[0] for b in boxes),
            }
            compress_report["actions"][action] = {
                "frames": len(images), "zip": zip_path.name,
                "pngMB": round(png_bytes / 1048576, 1),
                "webpMB": round(webp_bytes / 1048576, 1),
                "savingsPct": round((1 - webp_bytes / png_bytes) * 100, 1) if png_bytes > 0 else None,
                "reused": fresh,
            }
            print(f"{action}: {len(images)} frames, "
                  f"{png_bytes // 1048576} -> {webp_bytes // 1048576} MB webp{' (reused)' if fresh else ''}", flush=True)

        # Global scale from the idle body (no effects above the head).
        idle = prepared["idle"]
        scale = TARGET_H / (idle["feetMedian"] - idle["topMedian"])

        # Pass 2: feet-anchored strips.
        entries, total_kb = [], 0
        for action in sorted(LOOPS):
            p = prepared[action]
            webp_paths = p["paths"]
            chosen = sample(webp_paths, SAMPLE)  # 32/32 = full frame set
            e = build_strip(action, chosen, scale, p["anchorX"])
            total_kb += e["stripKB"]
            entries.append(e)
            print(f"  strip {action}: {e['frames']} frames, cellW={e['frameW']}, {e['stripKB']} KB", flush=True)
    finally:
        shutil.rmtree(work, ignore_errors=True)

    total_png = sum(v["pngMB"] for v in compress_report["actions"].values())
    total_webp = sum(v["webpMB"] for v in compress_report["actions"].values())
    compress_report["totals"] = {"pngMB": round(total_png, 1), "webpMB": round(total_webp, 1),
                                 "savingsPct": round((1 - total_webp / total_png) * 100, 1) if total_png > 0 else None}
    compress_report["finishedAt"] = time.strftime("%Y-%m-%dT%H:%M:%SZ")
    REPORT.write_text(json.dumps(compress_report, ensure_ascii=False, indent=2), encoding="utf-8")

    lines = [
        "// Generated by scripts/build-runtime-from-freecut.py — do not edit by hand.\n",
        "// Strips are EMBEDDED as WebP data URIs so the animation works with zero\n",
        "// host dependencies (no app restart needed). The same strips are also\n",
        "// written to assets/pet/action-sheets/<file> for a future host-served\n",
        "// lean mode (see src/index.ts /token-pet/strips route).\n",
        "// Global body scale unifies character size across actions; feet line = 520.\n",
        "// Horizontal: one FIXED stable anchor per action (median of per-frame\n",
        "// bottom-body centers) sits at each cell center, so the source frames'\n",
        "// original horizontal motion is preserved and wide effects stay uncropped.\n",
        "// pingPong: the player may walk the frames forwards then backwards for a\n",
        "// seamless round-trip loop (prompt-enhancing only).\n\n",
        "export interface ActionSheetSpec {\n",
        "  sheet: string; file: string; frameW: number; frameH: number; bodyHeight: number; feetY: number; frames: number;\n",
        "  cols: number; rows: number; delaysMs: number[]; loop: boolean; pingPong: boolean; totalMs: number;\n",
        "}\n\n",
        "export const PET_ACTION_SHEET_SPECS: Record<string, ActionSheetSpec> = {\n",
    ]
    for e in entries:
        delays = json.dumps([e["delay"]] * e["frames"], separators=(",", ":"))
        lines += [
            f"  '{e['action']}': {{\n",
            f"    sheet: 'data:image/webp;base64,{e['b64']}',\n",
            f"    file: '{e['file']}',\n",
            f"    frameW: {e['frameW']},\n",
            f"    frameH: {FRAME_H},\n",
            f"    bodyHeight: {TARGET_H},\n",
            f"    feetY: {FEET_Y},\n",
            f"    frames: {e['frames']},\n",
            f"    cols: {e['cols']},\n",
            f"    rows: {e['rows']},\n",
            f"    delaysMs: {delays},\n",
            f"    loop: {str(e['loop']).lower()},\n",
            f"    pingPong: {str(e['pingPong']).lower()},\n",
            f"    totalMs: {e['delay'] * e['frames']},\n",
            "  },\n",
        ]
    lines.append("}\n")
    OUT_TS.write_text("".join(lines), encoding="utf-8")
    print(f"wrote {OUT_TS} ({OUT_TS.stat().st_size // 1024} KB; strips total {total_kb} KB)", flush=True)


if __name__ == "__main__":
    main()
