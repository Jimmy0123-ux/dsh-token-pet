"""Export runtime strip frames for visual inspection + bottom row analysis."""
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
f0 = im.crop((0, 0, fw, im.height)).resize((fw * 2, 720), Image.NEAREST)
out = Path(r"Review/h3-actions/idle-strip-frame0.png")
f0.save(str(out))
print("saved", out)
