"""Remove residual white matte components after conservative sprite-gen cutout.

The conservative position matte protects pale foreground colours. This pass only
removes bright achromatic components that either touch existing transparency
(outer white outline/fringe) or are large near-pure-white enclosed background
holes. Interior garment/hair highlights remain.
"""
from collections import deque
from pathlib import Path
import json
import sys

import numpy as np
from PIL import Image

original_path = Path(sys.argv[1])
matte_path = Path(sys.argv[2])
out_path = Path(sys.argv[3])

original = np.array(Image.open(original_path).convert("RGB"), dtype=np.uint8)
result = np.array(Image.open(matte_path).convert("RGBA"), dtype=np.uint8)
alpha = result[:, :, 3]
h, w = alpha.shape

mx = original.max(axis=2)
mn = original.min(axis=2)
# Strict white/ivory candidate: excludes skin, green hair and cream fabric.
candidate = (alpha > 0) & (mn >= 242) & ((mx - mn) <= 12)
visited = np.zeros((h, w), dtype=bool)
remove = np.zeros((h, w), dtype=bool)
components = []

ys0, xs0 = np.where(candidate)
for sy, sx in zip(ys0.tolist(), xs0.tolist()):
    if visited[sy, sx]:
        continue
    queue = deque([(sy, sx)])
    visited[sy, sx] = True
    pixels = []
    touches_transparent = False
    min_x = max_x = sx
    min_y = max_y = sy
    while queue:
        y, x = queue.popleft()
        pixels.append((y, x))
        min_x = min(min_x, x); max_x = max(max_x, x)
        min_y = min(min_y, y); max_y = max(max_y, y)
        for ny, nx in ((y - 1, x), (y + 1, x), (y, x - 1), (y, x + 1)):
            if not (0 <= ny < h and 0 <= nx < w):
                touches_transparent = True
                continue
            if alpha[ny, nx] == 0:
                touches_transparent = True
            if candidate[ny, nx] and not visited[ny, nx]:
                visited[ny, nx] = True
                queue.append((ny, nx))
    area = len(pixels)
    values = original[[p[0] for p in pixels], [p[1] for p in pixels]].astype(np.float32)
    mean_min = float(values.min(axis=1).mean())
    # Outer fringe: must touch current transparent matte and be non-trivial.
    # Enclosed background hole: larger, very white, low-chroma component.
    should_remove = (touches_transparent and area >= 6) or (area >= 280 and mean_min >= 248)
    if should_remove:
        for y, x in pixels:
            remove[y, x] = True
    components.append({
        "area": area,
        "touchesTransparent": touches_transparent,
        "meanMin": round(mean_min, 2),
        "bbox": [min_x, min_y, max_x + 1, max_y + 1],
        "removed": should_remove,
    })

result[remove] = (0, 0, 0, 0)

# Rebuild a two-pixel soft edge only around newly removed white components.
# Use RGB distance from white as alpha and unmix the white matte.
bg = np.array([255.0, 255.0, 255.0], dtype=np.float32)
frontier = remove.copy()
for _ in range(2):
    grown = frontier.copy()
    grown[1:] |= frontier[:-1]
    grown[:-1] |= frontier[1:]
    grown[:, 1:] |= frontier[:, :-1]
    grown[:, :-1] |= frontier[:, 1:]
    frontier = grown
zone = frontier & ~remove & (result[:, :, 3] > 0)
for y, x in zip(*np.where(zone)):
    rgb = original[y, x].astype(np.float32)
    d = float(np.max(np.abs(rgb - bg)))
    a = max(0.0, min(1.0, (d - 18.0) / 72.0))
    if a < 1.0:
        if a <= 0.0:
            result[y, x] = (0, 0, 0, 0)
        else:
            fg = np.clip((rgb - (1.0 - a) * bg) / a, 0, 255)
            result[y, x, :3] = np.rint(fg).astype(np.uint8)
            result[y, x, 3] = round(a * 255)

# Restore definite warm skin pixels to their original colour and full opacity.
# White background is achromatic and cannot satisfy these channel relations.
rgb16 = original.astype(np.int16)
skin = (
    (rgb16[:, :, 0] >= 225)
    & (rgb16[:, :, 1] >= 160)
    & (rgb16[:, :, 2] >= 125)
    & ((rgb16[:, :, 0] - rgb16[:, :, 1]) >= 4)
    & ((rgb16[:, :, 1] - rgb16[:, :, 2]) >= 4)
)
result[skin, :3] = original[skin]
result[skin, 3] = 255

# Restore partially transparent central lace immediately above the legs. Keep
# fully transparent pixels untouched so the actual gap between the legs remains.
y_grid, x_grid = np.indices((h, w))
leg_skin = skin & (y_grid > int(h * 0.74)) & (x_grid > int(w * 0.42)) & (x_grid < int(w * 0.58))
restored_lace = np.zeros((h, w), dtype=bool)
if np.any(leg_skin):
    leg_y, leg_x = np.where(leg_skin)
    leg_top = int(leg_y.min())
    x_left = max(0, int(leg_x.min()) - 80)
    x_right = min(w, int(leg_x.max()) + 81)
    y_top = max(0, leg_top - 70)
    y_bottom = min(h, leg_top + 10)
    region = (
        (y_grid >= y_top) & (y_grid < y_bottom)
        & (x_grid >= x_left) & (x_grid < x_right)
    )
    restored_lace = region & (result[:, :, 3] > 0) & (result[:, :, 3] < 255)
    result[restored_lace, :3] = original[restored_lace]
    result[restored_lace, 3] = 255

Image.fromarray(result, "RGBA").save(out_path, optimize=True)
report = {
    "input": str(original_path),
    "matte": str(matte_path),
    "output": str(out_path),
    "candidateComponents": len(components),
    "removedComponents": sum(1 for c in components if c["removed"]),
    "removedPixels": int(remove.sum()),
    "restoredSkinPixels": int(skin.sum()),
    "restoredLacePixels": int(restored_lace.sum()),
    "largestRemoved": sorted((c for c in components if c["removed"]), key=lambda c: c["area"], reverse=True)[:20],
}
out_path.with_suffix(".cleanup.json").write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
print(json.dumps({k: report[k] for k in ("candidateComponents", "removedComponents", "removedPixels", "largestRemoved")}, ensure_ascii=False, indent=2))
