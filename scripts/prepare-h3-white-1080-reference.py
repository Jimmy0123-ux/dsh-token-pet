"""Create exact 1920x1088 white H3 reference from the canonical resident."""
from collections import deque
from pathlib import Path
import hashlib

import numpy as np
from PIL import Image

ROOT = Path(r"H:\ds\dsh-token-pet")
SOURCE = ROOT / "assets/qpet/identity/qpet-stage-01-newborn-v02-resident.png"
TARGET = ROOT / "Review/h3-actions/references/qpet-v15-resident-white-1920x1088.png"
CANVAS = (1920, 1088)
SUBJECT_HEIGHT = 990
THRESHOLD = 58.0

arr = np.array(Image.open(SOURCE).convert("RGB"))
h, w = arr.shape[:2]
bg = np.mean(np.array([arr[0, 0], arr[0, -1], arr[-1, 0], arr[-1, -1]], dtype=np.float32), axis=0)
mask = np.zeros((h, w), dtype=bool)
queue = deque()
for x in range(w):
    queue.extend(((0, x), (h - 1, x)))
for y in range(h):
    queue.extend(((y, 0), (y, w - 1)))
while queue:
    y, x = queue.popleft()
    if y < 0 or y >= h or x < 0 or x >= w or mask[y, x]:
        continue
    if float(np.linalg.norm(arr[y, x].astype(np.float32) - bg)) > THRESHOLD:
        continue
    mask[y, x] = True
    queue.extend(((y - 1, x), (y + 1, x), (y, x - 1), (y, x + 1)))
alpha = np.where(mask, 0, 255).astype(np.uint8)
ys, xs = np.where(alpha > 0)
box = (int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1)
subject = Image.fromarray(np.dstack([arr, alpha]), "RGBA").crop(box)
scale = SUBJECT_HEIGHT / subject.height
subject = subject.resize((round(subject.width * scale), SUBJECT_HEIGHT), Image.Resampling.LANCZOS)
canvas = Image.new("RGBA", CANVAS, (255, 255, 255, 255))
x = (CANVAS[0] - subject.width) // 2
y = (CANVAS[1] - subject.height) // 2
canvas.alpha_composite(subject, (x, y))
TARGET.parent.mkdir(parents=True, exist_ok=True)
canvas.convert("RGB").save(TARGET, optimize=True)
print("target", TARGET)
print("sha256", hashlib.sha256(TARGET.read_bytes()).hexdigest())
print("subject_on_canvas", (x, y, subject.width, subject.height))
