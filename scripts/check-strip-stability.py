"""Regression gate for artificial horizontal drift and prompt loop mode."""
import re
from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(r"H:\ds\dsh-token-pet")
TS = (ROOT / "src/client/pet-action-sheets.generated.ts").read_text(encoding="utf-8")
META = re.compile(
    r"frameW: (\d+),\s*frameH: (\d+),\s*bodyHeight: (\d+),\s*feetY: (\d+),"
    r"\s*frames: (\d+),\s*cols: (\d+),\s*rows: (\d+),.*?pingPong: (true|false),",
    re.S,
)


def weighted_center(xs: np.ndarray, weights: np.ndarray) -> float:
    return float((xs * weights).sum() / weights.sum())


def feet_center(alpha: np.ndarray) -> float:
    ys, xs = np.where(alpha > 16)
    weights = alpha[ys, xs].astype(float)
    ymin, ymax = int(ys.min()), int(ys.max())
    mask = ys >= ymin + 0.85 * max(1, ymax - ymin)
    return weighted_center(xs[mask], weights[mask])


def spec(action: str):
    start = TS.index(f"'{action}': {{")
    block = TS[start:TS.index("},", start)]
    match = META.search(block)
    if not match:
        raise AssertionError(f"metadata missing: {action}")
    return {
        "frameW": int(match.group(1)), "frameH": int(match.group(2)),
        "bodyHeight": int(match.group(3)), "frames": int(match.group(5)),
        "cols": int(match.group(6)), "rows": int(match.group(7)),
        "pingPong": match.group(8) == "true",
    }


def source_feet_range(action: str, scale: float) -> float:
    values = []
    source_dir = ROOT / "Review/h3-actions" / action / "transparent_frames_webp"
    for path in sorted(source_dir.glob("matte_*.webp")):
        values.append(feet_center(np.array(Image.open(path).convert("RGBA"))[:, :, 3]))
    return float(np.ptp(values) * scale)


def generated_feet_range(action: str) -> float:
    meta = spec(action)
    image = np.array(Image.open(ROOT / "assets/pet/action-sheets" / f"{action}.webp").convert("RGBA"))
    values = []
    for index in range(meta["frames"]):
        col, row = index % meta["cols"], index // meta["cols"]
        cell = image[
            row * meta["frameH"]:(row + 1) * meta["frameH"],
            col * meta["frameW"]:(col + 1) * meta["frameW"],
            3,
        ]
        values.append(feet_center(cell))
    return float(np.ptp(values))


# Global scale is defined by the idle source body span.
idle_files = sorted((ROOT / "Review/h3-actions/idle/transparent_frames_webp").glob("matte_*.webp"))
tops, bottoms = [], []
for path in idle_files:
    alpha = np.array(Image.open(path).convert("RGBA"))[:, :, 3]
    ys, _ = np.where(alpha > 16)
    tops.append(int(ys.min()))
    bottoms.append(int(ys.max()) + 1)
scale = spec("idle")["bodyHeight"] / (float(np.median(bottoms)) - float(np.median(tops)))

problems = []
report = {}
for action in ("click", "prompt-enhancing"):
    source_range = source_feet_range(action, scale)
    generated_range = generated_feet_range(action)
    difference = abs(generated_range - source_range)
    report[action] = {
        "sourceFeetRangeScaled": round(source_range, 2),
        "generatedFeetRange": round(generated_range, 2),
        "difference": round(difference, 2),
        "pingPong": spec(action)["pingPong"],
    }
    if difference > 2.0:
        problems.append(f"{action}: artificial horizontal drift {difference:.2f}px")

if spec("click")["pingPong"]:
    problems.append("click must not ping-pong")
if not spec("prompt-enhancing")["pingPong"]:
    problems.append("prompt-enhancing must ping-pong")

print({"ok": not problems, "scale": round(scale, 6), "actions": report, "problems": problems})
if problems:
    raise SystemExit(1)
