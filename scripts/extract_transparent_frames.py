"""Extract frames from sprite sheet and make them transparent.
Flood-fill BFS from borders to detect background color, then remove with edge feathering.
No scipy needed — only numpy + PIL."""
from pathlib import Path
import json
import numpy as np
from PIL import Image
from collections import deque

ROOT = Path(r'H:\ds\dsh-token-pet')
ZIP_DIR = ROOT / 'Review' / 'h3-actions' / 'idle' / 'sprite_extract'
OUT_DIR = ROOT / 'Review' / 'h3-actions' / 'idle' / 'frames'
OUT_DIR.mkdir(parents=True, exist_ok=True)

sheet = Image.open(ZIP_DIR / 'sprite.png').convert('RGBA')
index = json.loads((ZIP_DIR / 'index.json').read_text(encoding='utf-8'))
frames = index['frames']
print(f'Sheet: {sheet.size}, frames: {len(frames)}')

# Detect background color from corners of first frame (warm white background)
first = np.array(sheet.crop((0, 0, 864, 480)))
corners = [first[0,0,:3], first[0,-1,:3], first[-1,0,:3], first[-1,-1,:3]]
bg = np.mean(corners, axis=0)
print(f'Background color: {tuple(int(x) for x in bg)}')

def flood_and_feather(frame_arr, bg_color, hard_thresh=50, feather_px=3):
    """Flood fill from borders to detect background, remove it, feather edges."""
    h, w = frame_arr.shape[:2]
    arr = frame_arr.copy()
    mask = np.zeros((h, w), dtype=bool)
    q = deque()
    for x in range(w):
        q.append((0, x)); q.append((h-1, x))
    for y in range(h):
        q.append((y, 0)); q.append((y, w-1))
    while q:
        r, c = q.popleft()
        if r < 0 or r >= h or c < 0 or c >= w or mask[r, c]:
            continue
        pix = arr[r, c, :3].astype(float)
        dist = np.sqrt(np.sum((pix - bg_color) ** 2))
        if dist > hard_thresh:
            continue
        mask[r, c] = True
        q.append((r+1, c)); q.append((r-1, c))
        q.append((r, c+1)); q.append((r, c-1))
    # Clear background pixels
    result = arr.copy()
    result[mask, 3] = 0
    # Feather zone: dilate mask by feather_px and compute partial alpha
    dilated = mask.copy()
    for _ in range(feather_px):
        new = dilated.copy()
        for r in range(h):
            for c in range(w):
                if not dilated[r, c]:
                    for dr, dc in [(-1,0),(1,0),(0,-1),(0,1)]:
                        nr, nc = r+dr, c+dc
                        if 0 <= nr < h and 0 <= nc < w and dilated[nr, nc]:
                            new[r, c] = True
                            break
        dilated = new
    feather_zone = dilated & ~mask
    if np.any(feather_zone):
        fy, fx = np.where(feather_zone)
        for y, x in zip(fy, fx):
            pix = arr[y, x, :3].astype(float)
            dist = np.sqrt(np.sum((pix - bg_color) ** 2))
            alpha = min(255, int(255 * dist / 30))
            result[y, x, 3] = max(int(result[y, x, 3]), alpha)
    return result

for fi in frames:
    frame = sheet.crop((fi['x'], fi['y'], fi['x'] + fi['w'], fi['y'] + fi['h']))
    arr = np.array(frame)
    result = flood_and_feather(arr, bg)
    out = Image.fromarray(result.astype(np.uint8))
    out_path = OUT_DIR / f'frame-{fi["i"]:04d}.png'
    out.save(out_path)
    print(f'Frame {fi["i"]}: {out_path}')

print(f'\nDone! {len(frames)} transparent frames saved to {OUT_DIR}')
