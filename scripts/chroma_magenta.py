from collections import deque
from pathlib import Path
import hashlib, json, sys

import numpy as np
from PIL import Image


def sha256(path: Path) -> str:
    h = hashlib.sha256()
    with path.open('rb') as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b''):
            h.update(chunk)
    return h.hexdigest()


def magenta_score(rgb):
    # High when R and B are high and G is low (pure magenta).
    r = rgb[..., 0].astype(np.float32)
    g = rgb[..., 1].astype(np.float32)
    b = rgb[..., 2].astype(np.float32)
    return r + b - 2.0 * g


def flood_label(mask):
    """Return an int label array of 4-connected components of `mask` (bool)."""
    h, w = mask.shape
    lab = np.zeros((h, w), dtype=np.int32)
    cur = 0
    for y in range(h):
        for x in range(w):
            if mask[y, x] and lab[y, x] == 0:
                cur += 1
                q = deque([(y, x)])
                lab[y, x] = cur
                while q:
                    cy, cx = q.popleft()
                    for ny, nx in ((cy + 1, cx), (cy - 1, cx), (cy, cx + 1), (cy, cx - 1)):
                        if 0 <= ny < h and 0 <= nx < w and mask[ny, nx] and lab[ny, nx] == 0:
                            lab[ny, nx] = cur
                            q.append((ny, nx))
    return lab


def process(src: Path, dst: Path) -> dict:
    im = Image.open(src).convert('RGB')
    a = np.array(im).astype(np.float32)
    h, w, _ = a.shape
    rgb = a[..., :3]
    border = np.concatenate([
        rgb[0:3].reshape(-1, 3), rgb[h - 3:h].reshape(-1, 3),
        rgb[:, 0:3].reshape(-1, 3), rgb[:, w - 3:w].reshape(-1, 3),
    ])
    bg = np.median(border, axis=0)
    bg_scr = float(magenta_score(bg))
    score = magenta_score(rgb)
    dist = np.abs(score - bg_scr)

    # Hard magenta cutoff: anything clearly magenta becomes transparent.
    # Global (not border-flood) so interior background bleed on translucent
    # garments is removed too. Soft feather keeps the character edge smooth.
    hard = 55.0
    soft = 95.0

    alpha = np.full((h, w), 255.0, dtype=np.float32)
    # Region where magenta dominates → drop alpha to 0 (with feather on edges).
    mag = dist < soft
    al = np.where(dist <= hard, 0.0, 255.0 * (dist - hard) / (soft - hard))
    alpha[mag] = np.clip(al[mag], 0, 255)

    # Despill: neutralize magenta cast on the retained foreground (stockings/sleeves)
    # by pulling red+blue down toward green. Strong enough to turn purple back to neutral.
    fg = rgb.copy()
    spam = magenta_score(fg)
    spill = np.clip(spam, 0, 220)[..., None] * 0.85
    fg[..., 0] = np.clip(fg[..., 0] - spill[..., 0], 0, 255)
    fg[..., 2] = np.clip(fg[..., 2] - spill[..., 0], 0, 255)

    rgba = np.dstack([fg, alpha]).astype(np.uint8)
    img = Image.fromarray(rgba, 'RGBA')

    # Prune isolated opaque specks: keep only the connected component touching the
    # largest opaque blob (the character), dropping stray edge noise so the trim
    # snaps to the figure.
    al = np.array(img)[:, :, 3] > 8
    lbl = flood_label(al)
    if lbl.max() > 0:
        sizes = np.bincount(lbl.ravel())
        sizes[0] = 0
        keep = int(sizes.argmax())
        mask = lbl == keep
        arr = np.array(img).copy()
        arr[~mask, 3] = 0
        img = Image.fromarray(arr, 'RGBA')

    dst.parent.mkdir(parents=True, exist_ok=True)
    img.save(dst, 'PNG', optimize=True)

    arr = np.array(img)[:, :, 3]
    bbox = Image.fromarray(arr, 'L').getbbox()
    return {
        'sourcePath': src.as_posix(), 'sourceSha256': sha256(src),
        'operations': [
            {'op': 'chroma-magenta-global', 'bgRgb': [int(c) for c in bg], 'hardDistance': hard, 'softDistance': soft},
            {'op': 'despill', 'strength': 0.85},
        ],
        'outputPath': dst.as_posix(), 'outputSha256': sha256(dst),
        'outputSize': [img.width, img.height], 'alphaBbox': bbox,
        'transparentFrac': round(float((arr == 0).mean()), 4),
        'tool': 'chroma-key-global v03',
    }


if __name__ == '__main__':
    src, dst = map(Path, sys.argv[1:3])
    rec = process(src, dst)
    print(json.dumps(rec))
