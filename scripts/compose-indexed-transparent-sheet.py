"""Compose cut-out frames back into the original indexed sheet layout."""
from pathlib import Path
import json
import shutil
import sys
import numpy as np
from PIL import Image

folder = Path(sys.argv[1]).resolve()
out_name = sys.argv[2] if len(sys.argv) > 2 else "transparent"
index = json.loads((folder / "index.json").read_text(encoding="utf-8"))
frames = folder / out_name / "frames"
out_dir = folder / out_name
out_dir.mkdir(parents=True, exist_ok=True)
sheet = Image.new("RGBA", (index["sheet_size"]["w"], index["sheet_size"]["h"]), (0, 0, 0, 0))
report = []
for frame in index["frames"]:
    path = frames / f"frame-{frame['i']:04d}.png"
    image = Image.open(path).convert("RGBA")
    expected = (frame["w"], frame["h"])
    if image.size != expected:
        raise SystemExit(f"frame size mismatch {path}: {image.size} != {expected}")
    alpha = np.array(image)[:, :, 3]
    zero = float((alpha == 0).mean())
    opaque = float((alpha == 255).mean())
    if zero < 0.50:
        raise SystemExit(f"frame background not sufficiently transparent: {path}, alpha0={zero:.4f}")
    sheet.alpha_composite(image, (frame["x"], frame["y"]))
    report.append({
        "i": frame["i"],
        "file": str(path.relative_to(folder)).replace("\\", "/"),
        "alphaZeroPct": round(zero * 100, 3),
        "alphaOpaquePct": round(opaque * 100, 3),
    })
out_sheet = out_dir / "sprite-transparent.png"
sheet.save(out_sheet, optimize=True)
shutil.copy2(folder / "index.json", out_dir / "index.json")
(out_dir / "cutout-report.json").write_text(json.dumps({
    "source": "sprite.png + index.json",
    "engine": "sprite-gen cutout --key auto (white position matte)",
    "sheet": "sprite-transparent.png",
    "frames": report,
}, ensure_ascii=False, indent=2), encoding="utf-8")
print(out_sheet)
print("frames", len(report))
print("alpha0 range", min(x["alphaZeroPct"] for x in report), max(x["alphaZeroPct"] for x in report))
