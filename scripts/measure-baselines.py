"""Measure feet baseline and body height per action strip (multi-row aware)."""
import re
from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(r"H:\ds\dsh-token-pet")
STRIP_DIR = ROOT / "assets/pet/action-sheets"
TS = (ROOT / "src/client/pet-action-sheets.generated.ts").read_text(encoding="utf-8")

META = re.compile(
    r"frameH: (\d+),\s*bodyHeight: (\d+),\s*feetY: (\d+),\s*frames: (\d+),\s*cols: (\d+),\s*rows: (\d+),",
    re.S)

for strip in sorted(STRIP_DIR.glob("*.webp")):
    action = strip.stem
    i = TS.index(f"'{action}': {{")
    block = TS[i:TS.index("},", i)]
    m = META.search(block)
    if not m:
        print(f"{action:16s} (metadata missing)")
        continue
    frame_h, cols, rows = int(m.group(1)), int(m.group(5)), int(m.group(6))
    im = Image.open(strip).convert("RGBA")
    fw = im.width // cols
    tops, bots = [], []
    for k in range(rows * cols):
        col, row = k % cols, k // cols
        cell = np.array(im.crop((col * fw, row * frame_h, (col + 1) * fw, (row + 1) * frame_h)))
        al = cell[:, :, 3]
        ys, _ = np.where(al > 16)
        if len(ys) == 0:
            continue
        tops.append(int(ys.min())); bots.append(int(ys.max()))
    print(f"{action:16s} feet={max(bots)} top={min(tops)} span={max(bots) - min(tops)} (cells {cols}x{rows})")
