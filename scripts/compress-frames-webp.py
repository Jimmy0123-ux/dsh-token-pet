"""Compress all transparent PNG frames to WebP q90, keeping originals intact."""
from pathlib import Path
import json
import time

import numpy as np
from PIL import Image

ROOT = Path(r"H:\ds\dsh-token-pet")
ACTION_ROOT = ROOT / "Review/h3-actions"
QUALITY = 90
METHOD = 6
report = {"quality": QUALITY, "method": METHOD, "actions": {}, "startedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ")}

for action_dir in sorted(p for p in ACTION_ROOT.iterdir() if p.is_dir()):
    src_dir = action_dir / "transparent_frames"
    if not src_dir.is_dir():
        continue
    out_dir = action_dir / "transparent_frames_webp"
    out_dir.mkdir(parents=True, exist_ok=True)
    frames = sorted(src_dir.glob("matte_*.png"))
    png_bytes = webp_bytes = 0
    max_alpha_diff = 0.0
    max_rgb_diff = 0.0
    for frame in frames:
        target = out_dir / (frame.stem + ".webp")
        image = Image.open(frame).convert("RGBA")
        image.save(target, "WEBP", quality=QUALITY, method=METHOD)
        png_bytes += frame.stat().st_size
        webp_bytes += target.stat().st_size
        original = np.array(image, dtype=np.int16)
        roundtrip = np.array(Image.open(target).convert("RGBA"), dtype=np.int16)
        diff = np.abs(original - roundtrip)
        max_alpha_diff = max(max_alpha_diff, float((diff[:, :, 3] > 8).mean()))
        max_rgb_diff = max(max_rgb_diff, float((diff[:, :, :3] > 8).mean()))
    report["actions"][action_dir.name] = {
        "frames": len(frames),
        "pngMB": round(png_bytes / 1048576, 1),
        "webpMB": round(webp_bytes / 1048576, 1),
        "savingsPct": round((1 - webp_bytes / png_bytes) * 100, 1),
        "worstAlphaDeviationPct": round(max_alpha_diff * 100, 3),
        "worstRgbDeviationPct": round(max_rgb_diff * 100, 3),
    }
    print(action_dir.name, len(frames), "frames",
          round(png_bytes / 1048576, 1), "->", round(webp_bytes / 1048576, 1), "MB", flush=True)

total_png = sum(v["pngMB"] for v in report["actions"].values())
total_webp = sum(v["webpMB"] for v in report["actions"].values())
report["totals"] = {
    "pngMB": round(total_png, 1),
    "webpMB": round(total_webp, 1),
    "savingsPct": round((1 - total_webp / total_png) * 100, 1),
}
report["finishedAt"] = time.strftime("%Y-%m-%dT%H:%M:%SZ")
out = ROOT / "Review/h3-actions/webp-compression-report.json"
out.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
print(json.dumps(report["totals"], indent=2))
