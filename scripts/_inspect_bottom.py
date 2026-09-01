"""Inspect strip bottom rows to find what reaches y=339."""
import base64
import io
import re
from pathlib import Path

import numpy as np
from PIL import Image

ts = Path(r"src/client/pet-action-sheets.generated.ts").read_text(encoding="utf-8")
m = re.search(r"'idle': \{\s*sheet: 'data:image/webp;base64,([^']+)'", ts)
im = Image.open(io.BytesIO(base64.b64decode(m.group(1)))).convert("RGBA")
fw = im.width // 32
cell = np.array(im.crop((0, 0, fw, im.height)))
al = cell[:, :, 3]
for y in (300, 310, 320, 330, 335, 338, 339):
    row = al[y]
    nz = np.where(row > 16)[0]
    if len(nz):
        print(f"y={y} nonzero={len(nz)} x=({int(nz.min())},{int(nz.max())})")
    else:
        print(f"y={y} empty")
# where is the alpha >16 boundary in the original 1088 frame? feet bottom at 1038/1088
# The strip normalized body to 320 tall in 360 cell: bottom = oy+ch
# oy=(360-ch)//2 ; if ch=320 -> oy=20, bottom=340. feet reach 339 -> correct.
# But is the boot bottom cut? check row 339 x-range vs row 320
