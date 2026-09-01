"""Check per-frame alignment inside the generated runtime strips."""
import base64
import io
import re
from pathlib import Path

import numpy as np
from PIL import Image

ts = Path(r"src/client/pet-action-sheets.generated.ts").read_text(encoding="utf-8")
for m in re.finditer(r"'([a-z-]+)': \{\s*sheet: 'data:image/webp;base64,([^']+)'", ts):
    action = m.group(1)
    im = Image.open(io.BytesIO(base64.b64decode(m.group(2)))).convert("RGBA")
    frames = 32 if action == "idle" else 8
    fw = im.width // frames
    tops, bots, lefts, rights = [], [], [], []
    for i in range(frames):
        cell = np.array(im.crop((i * fw, 0, (i + 1) * fw, im.height)))
        al = cell[:, :, 3]
        ys, xs = np.where(al > 16)
        tops.append(int(ys.min())); bots.append(int(ys.max()))
        lefts.append(int(xs.min())); rights.append(int(xs.max()))
    print(f"{action:16s} frames={frames} cellW={fw} "
          f"top {min(tops)}-{max(tops)} bottom {min(bots)}-{max(bots)} "
          f"left {min(lefts)}-{max(lefts)} right {min(rights)}-{max(rights)}")
