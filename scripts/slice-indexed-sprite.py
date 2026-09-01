"""Slice exact frames from a sprite.png using its index.json rectangles."""
from pathlib import Path
import json
import sys
from PIL import Image

folder = Path(sys.argv[1]).resolve()
index = json.loads((folder / "index.json").read_text(encoding="utf-8"))
sheet = Image.open(folder / "sprite.png").convert("RGB")
expected = (index["sheet_size"]["w"], index["sheet_size"]["h"])
if sheet.size != expected:
    raise SystemExit(f"sheet size mismatch: got {sheet.size}, expected {expected}")
out = folder / "frames-original"
out.mkdir(parents=True, exist_ok=True)
for frame in index["frames"]:
    box = (frame["x"], frame["y"], frame["x"] + frame["w"], frame["y"] + frame["h"])
    target = out / f"frame-{frame['i']:04d}.png"
    sheet.crop(box).save(target, optimize=True)
    print(target)
print("frames", len(index["frames"]))
