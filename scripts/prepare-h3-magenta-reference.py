"""Create a magenta-key H3 reference without changing the resident character.

Only the white/ivory region connected to the image border is replaced. Interior
white garment highlights remain intact. This derivative is an H3 generation
input, never the canonical identity asset.
"""
from collections import deque
from pathlib import Path
import hashlib

import numpy as np
from PIL import Image

ROOT = Path(r"H:\ds\dsh-token-pet")
SOURCE = ROOT / "assets/qpet/identity/qpet-stage-01-newborn-v02-resident.png"
TARGET = ROOT / "Review/h3-actions/references/qpet-v15-resident-magenta.png"
TARGET_864 = ROOT / "Review/h3-actions/references/qpet-v15-resident-magenta-864x480.png"
TARGET_1088 = ROOT / "Review/h3-actions/references/qpet-v15-resident-magenta-1920x1088.png"
KEY = np.array([255, 0, 255], dtype=np.uint8)
THRESHOLD = 58.0
CANVAS_SIZE = (864, 480)
SUBJECT_HEIGHT = 438
CANVAS_1088 = (1920, 1088)
SUBJECT_HEIGHT_1088 = 990

image = Image.open(SOURCE).convert("RGB")
arr = np.array(image)
h, w = arr.shape[:2]
corner_samples = np.array([
    arr[0, 0], arr[0, w - 1], arr[h - 1, 0], arr[h - 1, w - 1]
], dtype=np.float32)
background = corner_samples.mean(axis=0)

mask = np.zeros((h, w), dtype=bool)
queue = deque()
for x in range(w):
    queue.append((0, x))
    queue.append((h - 1, x))
for y in range(h):
    queue.append((y, 0))
    queue.append((y, w - 1))

while queue:
    y, x = queue.popleft()
    if y < 0 or y >= h or x < 0 or x >= w or mask[y, x]:
        continue
    pixel = arr[y, x].astype(np.float32)
    if float(np.linalg.norm(pixel - background)) > THRESHOLD:
        continue
    mask[y, x] = True
    queue.extend(((y - 1, x), (y + 1, x), (y, x - 1), (y, x + 1)))

out = arr.copy()
out[mask] = KEY
TARGET.parent.mkdir(parents=True, exist_ok=True)
Image.fromarray(out, "RGB").save(TARGET, optimize=True)

# Build an exact 864x480 generation reference so H3 never needs to invent
# aspect-ratio side margins. Use the same border-connected matte as alpha.
alpha = np.where(mask, 0, 255).astype(np.uint8)
subject_rgba = np.dstack([arr, alpha])
ys, xs = np.where(alpha > 0)
box = (int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1)
subject = Image.fromarray(subject_rgba, "RGBA").crop(box)
scale = SUBJECT_HEIGHT / subject.height
subject = subject.resize((round(subject.width * scale), SUBJECT_HEIGHT), Image.Resampling.LANCZOS)
canvas = Image.new("RGBA", CANVAS_SIZE, (255, 0, 255, 255))
x = (CANVAS_SIZE[0] - subject.width) // 2
y = (CANVAS_SIZE[1] - subject.height) // 2
canvas.alpha_composite(subject, (x, y))
canvas.convert("RGB").save(TARGET_864, optimize=True)

# Matching native 1920x1088 reference for direct 1080-class generation.
subject_1088 = Image.fromarray(subject_rgba, "RGBA").crop(box)
scale_1088 = SUBJECT_HEIGHT_1088 / subject_1088.height
subject_1088 = subject_1088.resize(
    (round(subject_1088.width * scale_1088), SUBJECT_HEIGHT_1088),
    Image.Resampling.LANCZOS,
)
canvas_1088 = Image.new("RGBA", CANVAS_1088, (255, 0, 255, 255))
x1088 = (CANVAS_1088[0] - subject_1088.width) // 2
y1088 = (CANVAS_1088[1] - subject_1088.height) // 2
canvas_1088.alpha_composite(subject_1088, (x1088, y1088))
canvas_1088.convert("RGB").save(TARGET_1088, optimize=True)

print("source", SOURCE)
print("source_sha256", hashlib.sha256(SOURCE.read_bytes()).hexdigest())
print("target", TARGET)
print("target_sha256", hashlib.sha256(TARGET.read_bytes()).hexdigest())
print("target_864", TARGET_864)
print("target_864_sha256", hashlib.sha256(TARGET_864.read_bytes()).hexdigest())
print("target_1088", TARGET_1088)
print("target_1088_sha256", hashlib.sha256(TARGET_1088.read_bytes()).hexdigest())
print("size", f"{w}x{h}")
print("subject_bbox", box)
print("subject_on_canvas", (x, y, subject.width, subject.height))
print("subject_on_canvas_1088", (x1088, y1088, subject_1088.width, subject_1088.height))
print("background_rgb", tuple(round(float(v), 2) for v in background))
print("replaced_fraction", round(float(mask.mean()), 6))
