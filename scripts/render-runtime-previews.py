"""Render runtime strip previews: 4 sampled frames per key action (multi-row aware)."""
import re
from pathlib import Path

from PIL import Image

ROOT = Path(r"H:\ds\dsh-token-pet")
STRIP_DIR = ROOT / "assets/pet/action-sheets"
TS = (ROOT / "src/client/pet-action-sheets.generated.ts").read_text(encoding="utf-8")

META = re.compile(
    r"frameH: (\d+),\s*bodyHeight: (\d+),\s*feetY: (\d+),\s*frames: (\d+),\s*cols: (\d+),\s*rows: (\d+),",
    re.S)

for action, picks in (("idle", [0, 10, 21, 31]), ("evolve", [0, 10, 21, 31]), ("working", [0, 10, 21, 31])):
    i = TS.index(f"'{action}': {{")
    m = META.search(TS[i:TS.index("},", i)])
    if not m:
        print(action, "metadata missing")
        continue
    frame_h, cols, rows = int(m.group(1)), int(m.group(5)), int(m.group(6))
    im = Image.open(STRIP_DIR / f"{action}.webp").convert("RGBA")
    fw = im.width // cols
    out = Image.new("RGBA", (fw * len(picks), frame_h), (45, 45, 45, 255))
    for n, idx in enumerate(picks):
        col, row = idx % cols, idx // cols
        out.alpha_composite(im.crop((col * fw, row * frame_h, (col + 1) * fw, (row + 1) * frame_h)), (n * fw, 0))
    out_path = ROOT / "Review" / "h3-actions" / f"runtime-preview-{action}.png"
    out.save(out_path)
    print(action, im.size, "->", out_path)
