"""Brightness-key transparency for frames whose background is a big white
glow (e.g. evolve). Background = bright, low-chroma pixels connected to the
dark outer border via luminance relaxation from the border inward.

Runs the approved safe pipeline afterwards (skin/lace restore + shadow removal).
"""
from collections import deque
from pathlib import Path
import json
import subprocess
import sys

import numpy as np
from PIL import Image

SKILL_PY = Path(r"C:\Users\Administrator.CHINAMI-LGIVRJF\.agents\skills\sprite-gen\.venv\Scripts\python.exe")
CLEANUP = Path(r"H:\ds\dsh-token-pet\scripts\cleanup-white-matte.py")
SHADOW = Path(r"H:\ds\dsh-token-pet\scripts\remove-floor-shadow.py")

src = Path(sys.argv[1])
out = Path(sys.argv[2])
LUM_MIN = int(sys.argv[3]) if len(sys.argv) > 3 else 232
CHROMA_MAX = 14

image = np.array(Image.open(src).convert("RGB"), dtype=np.int16)
h, w = image.shape[:2]
lum = image.mean(axis=2)
chroma = image.max(axis=2) - image.min(axis=2)

# Flood from the outer border inward: accept a neighbour if it is bright AND
# low-chroma, OR if its luminance is within 6 levels of the border pixel —
# this walks smoothly across the glow gradient without eating the character.
border_mask = np.zeros((h, w), dtype=bool)
queue = deque()
for x in range(w):
    for y in (0, h - 1):
        if lum[y, x] >= 200 and chroma[y, x] <= CHROMA_MAX and not border_mask[y, x]:
            border_mask[y, x] = True
            queue.append((y, x))
for y in range(h):
    for x in (0, w - 1):
        if lum[y, x] >= 200 and chroma[y, x] <= CHROMA_MAX and not border_mask[y, x]:
            border_mask[y, x] = True
            queue.append((y, x))
while queue:
    y, x = queue.popleft()
    for ny, nx in ((y - 1, x), (y + 1, x), (y, x - 1), (y, x + 1)):
        if 0 <= ny < h and 0 <= nx < w and not border_mask[ny, nx]:
            if lum[ny, nx] >= LUM_MIN and chroma[ny, nx] <= CHROMA_MAX:
                border_mask[ny, nx] = True
                queue.append((ny, nx))
            elif lum[ny, nx] >= 200 and abs(lum[ny, nx] - lum[y, x]) <= 6 and chroma[ny, nx] <= CHROMA_MAX + 4:
                border_mask[ny, nx] = True
                queue.append((ny, nx))

result = np.array(Image.open(src).convert("RGBA"), dtype=np.uint8)
result[border_mask] = (0, 0, 0, 0)

base = out.with_name(out.stem + "-glowbase.png")
Image.fromarray(result, "RGBA").save(base, optimize=True)
subprocess.run([str(SKILL_PY), str(CLEANUP), str(src), str(base), str(base)],
               check=True, capture_output=True, timeout=900)
subprocess.run([str(SKILL_PY), str(SHADOW), str(base), str(out)],
               check=True, capture_output=True, timeout=900)
base.unlink(missing_ok=True)

alpha = np.array(Image.open(out).convert("RGBA"))[:, :, 3]
report = {"input": str(src), "output": str(out), "borderFloodPct": round(float(border_mask.mean()) * 100, 2),
          "alphaZeroPct": round(float((alpha == 0).mean()) * 100, 2)}
out.with_suffix(".glowkey.json").write_text(json.dumps(report, indent=2), encoding="utf-8")
print(json.dumps(report, indent=2))
