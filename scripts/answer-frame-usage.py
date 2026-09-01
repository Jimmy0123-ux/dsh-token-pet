"""Answer: are all 32 source frames used per action?"""
import re
from pathlib import Path

import numpy as np
from PIL import Image

ts = Path(r"src/client/pet-action-sheets.generated.ts").read_text(encoding="utf-8")
spec = dict(re.findall(r"'([a-z-]+)': \{[^}]*?frames: (\d+)", ts))
print("frames declared in runtime spec:")
for k, v in spec.items():
    print(f"  {k:16s} {v}")
print()
print("webp frames on disk (user re-cut zips):")
for k in spec:
    n = len(list(Path(rf"Review/h3-actions/{k}/transparent_frames_webp").glob("matte_*.webp")))
    used = "ALL" if int(spec[k]) == n else f"sampled {spec[k]}/{n}"
    print(f"  {k:16s} {n:3d}  -> runtime uses {used}")
