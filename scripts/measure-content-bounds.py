"""Measure per-action source content bounds to size the runtime cells."""
from pathlib import Path
import json
import subprocess
import tempfile
import shutil

import numpy as np
from PIL import Image

ROOT = Path(r"H:\ds\dsh-token-pet")
ACTION_ROOT = ROOT / "Review/h3-actions"
work = Path(tempfile.mkdtemp(prefix="measure-"))
summary = {}
try:
    for action_dir in sorted(p for p in ACTION_ROOT.iterdir() if p.is_dir()):
        zips = sorted(action_dir.glob("免费在线抠图-*.zip"))
        if not zips:
            continue
        dest = work / action_dir.name
        subprocess.run(["powershell", "-NoProfile", "-Command",
                        f"Expand-Archive -LiteralPath '{zips[-1]}' -DestinationPath '{dest}' -Force"],
                       check=True, timeout=300)
        frames = sorted(dest.rglob("matte_*.png"))
        tops, bots, lefts, rights = [], [], [], []
        for f in frames:
            a = np.array(Image.open(f).convert("RGBA"))[:, :, 3]
            ys, xs = np.where(a > 16)
            if len(xs) == 0:
                continue
            tops.append(int(ys.min())); bots.append(int(ys.max()))
            lefts.append(int(xs.min())); rights.append(int(xs.max()))
        summary[action_dir.name] = {
            "frames": len(frames),
            "topMedian": int(np.median(tops)), "feetMedian": int(np.median(bots)),
            "topMin": min(tops), "feetMax": max(bots),
            "leftMin": min(lefts), "rightMax": max(rights),
            "maxWidth": max(r - l for l, r in zip(lefts, rights)) + 1,
            "unionWidth": max(rights) - min(lefts) + 1,
        }
        print(action_dir.name, summary[action_dir.name])
finally:
    shutil.rmtree(work, ignore_errors=True)

# Body height from idle (plain standing, no effects above head)
idle = summary["idle"]
body_h = idle["feetMedian"] - idle["topMedian"]
scale = 320 / body_h
print(json.dumps({
    "bodyHeightSource": body_h,
    "globalScale": round(scale, 5),
    "widestScaled": max(int(v["unionWidth"] * scale) for v in summary.values()),
    "tallestAboveHeadScaled": max(int((idle["topMedian"] - v["topMin"]) * scale) for v in summary.values()),
}, indent=2))
