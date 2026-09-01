"""Slice an AI-generated 4x2 sheet and normalize frames to a bottom-center foot anchor.

This intentionally uses Pillow only. It removes the bright checkerboard by flood
filling background-like pixels from each crop's border, finds a boot/foot pivot,
and places every frame on a fixed transparent canvas with one shared scale.
"""
from __future__ import annotations

import argparse
import json
from collections import deque
from pathlib import Path
from statistics import median

from PIL import Image


def is_background(rgb: tuple[int, int, int]) -> bool:
    r, g, b = rgb
    # Generated checkerboard is neutral gray/white (roughly 236..255). Restrict
    # removal to neutral bright pixels so cream clothing remains intact.
    return min(r, g, b) >= 224 and max(r, g, b) - min(r, g, b) <= 5


def remove_border_background(image: Image.Image) -> Image.Image:
    rgba = image.convert("RGBA")
    px = rgba.load()
    w, h = rgba.size
    seen = bytearray(w * h)
    q: deque[tuple[int, int]] = deque()

    def enqueue(x: int, y: int) -> None:
        i = y * w + x
        if seen[i]:
            return
        seen[i] = 1
        if is_background(px[x, y][:3]):
            q.append((x, y))

    for x in range(w):
        enqueue(x, 0)
        enqueue(x, h - 1)
    for y in range(h):
        enqueue(0, y)
        enqueue(w - 1, y)

    while q:
        x, y = q.popleft()
        px[x, y] = (255, 255, 255, 0)
        if x:
            enqueue(x - 1, y)
        if x + 1 < w:
            enqueue(x + 1, y)
        if y:
            enqueue(x, y - 1)
        if y + 1 < h:
            enqueue(x, y + 1)

    # Convert near-background edge pixels that touch transparency to partial
    # alpha. This softens the light checkerboard fringe without erasing clothes.
    for _ in range(2):
        updates: list[tuple[int, int, int]] = []
        for y in range(1, h - 1):
            for x in range(1, w - 1):
                r, g, b, a = px[x, y]
                if a == 0 or min(r, g, b) < 210 or max(r, g, b) - min(r, g, b) > 12:
                    continue
                if any(px[nx, ny][3] == 0 for nx, ny in ((x - 1, y), (x + 1, y), (x, y - 1), (x, y + 1))):
                    alpha = max(0, min(255, (224 - min(r, g, b)) * 18))
                    updates.append((x, y, alpha))
        for x, y, alpha in updates:
            r, g, b, _ = px[x, y]
            px[x, y] = (r, g, b, alpha)
    return rgba


def drop_small_components(image: Image.Image, min_area: int = 400) -> Image.Image:
    """Remove isolated background-removal specks while retaining props and body."""
    px = image.load()
    w, h = image.size
    visited = bytearray(w * h)
    for y in range(h):
        for x in range(w):
            i = y * w + x
            if visited[i] or px[x, y][3] < 24:
                continue
            stack = [(x, y)]
            visited[i] = 1
            component: list[tuple[int, int]] = []
            while stack:
                cx, cy = stack.pop()
                component.append((cx, cy))
                for nx in range(max(0, cx - 1), min(w, cx + 2)):
                    for ny in range(max(0, cy - 1), min(h, cy + 2)):
                        ni = ny * w + nx
                        if visited[ni] or px[nx, ny][3] < 24:
                            continue
                        visited[ni] = 1
                        stack.append((nx, ny))
            if len(component) < min_area:
                for cx, cy in component:
                    r, g, b, _ = px[cx, cy]
                    px[cx, cy] = (r, g, b, 0)
    return image


def alpha_bbox(image: Image.Image) -> tuple[int, int, int, int]:
    box = image.getchannel("A").getbbox()
    if box is None:
        raise ValueError("frame contains no foreground pixels")
    return box


def foot_anchor(image: Image.Image, box: tuple[int, int, int, int]) -> tuple[float, float]:
    """Estimate boot-bottom center while ignoring the console on frame-left."""
    px = image.load()
    left, top, right, bottom = box
    width, height = right - left, bottom - top
    candidates: list[tuple[int, int]] = []
    # The approved working pose places the character to the right of its console.
    min_x = left + int(width * 0.39)
    min_y = top + int(height * 0.58)
    for y in range(min_y, bottom):
        for x in range(min_x, right):
            r, g, b, a = px[x, y]
            if a < 80:
                continue
            mx, mn = max(r, g, b), min(r, g, b)
            saturation = (mx - mn) / max(1, mx)
            if mx < 195 and saturation > 0.12:
                candidates.append((x, y))
    if not candidates:
        return ((left + right) / 2, float(bottom - 1))
    foot_y = max(y for _, y in candidates)
    near_bottom = [x for x, y in candidates if y >= foot_y - 14]
    return (float(median(near_bottom)), float(foot_y))


def grid_crops(sheet: Image.Image) -> list[Image.Image]:
    # AI honored four columns, but each visual row is taller than 256 px.
    # These crop bands capture each complete figure without neighboring rows.
    rows = ((0, 500), (500, 1000))
    crops: list[Image.Image] = []
    for y0, y1 in rows:
        for x0 in (0, 256, 512, 768):
            crops.append(sheet.crop((x0, y0, x0 + 256, y1)))
    return crops


def normalize(input_path: Path, output_dir: Path, canvas=(256, 256), target_anchor=(128, 232)) -> dict:
    sheet = Image.open(input_path).convert("RGBA")
    prepared = [drop_small_components(remove_border_background(crop)) for crop in grid_crops(sheet)]
    records = []
    for frame in prepared:
        box = alpha_bbox(frame)
        pivot = foot_anchor(frame, box)
        records.append((frame, box, pivot))

    ax, ay = target_anchor
    margin = 10
    scales = []
    for _, box, (px, py) in records:
        left, top, right, bottom = box
        extents = [
            (ax - margin) / max(1, px - left),
            (canvas[0] - ax - margin) / max(1, right - px),
            (ay - margin) / max(1, py - top),
            (canvas[1] - ay - margin) / max(1, bottom - py),
        ]
        scales.append(min(extents))
    shared_scale = min(1.0, min(scales))

    output_dir.mkdir(parents=True, exist_ok=True)
    normalized: list[Image.Image] = []
    metadata_frames = []
    for index, (frame, box, (px, py)) in enumerate(records, start=1):
        cropped = frame.crop(box)
        new_size = (
            max(1, round(cropped.width * shared_scale)),
            max(1, round(cropped.height * shared_scale)),
        )
        resized = cropped.resize(new_size, Image.Resampling.LANCZOS)
        local_px = (px - box[0]) * shared_scale
        local_py = (py - box[1]) * shared_scale
        paste_x = round(ax - local_px)
        paste_y = round(ay - local_py)
        canvas_image = Image.new("RGBA", canvas, (0, 0, 0, 0))
        canvas_image.alpha_composite(resized, (paste_x, paste_y))
        frame_path = output_dir / f"frame-{index:03d}.png"
        canvas_image.save(frame_path)
        normalized.append(canvas_image)
        metadata_frames.append({"file": frame_path.name, "sourceBox": list(box), "sourceFoot": [px, py]})

    gif_path = output_dir / "working-bottom-center-preview.gif"
    normalized[0].save(
        gif_path,
        save_all=True,
        append_images=normalized[1:],
        duration=140,
        loop=0,
        disposal=2,
        transparency=0,
    )
    webp_path = output_dir / "working-bottom-center-preview.webp"
    normalized[0].save(
        webp_path,
        save_all=True,
        append_images=normalized[1:],
        duration=140,
        loop=0,
        lossless=True,
        method=6,
    )
    meta = {
        "source": str(input_path),
        "canvas": {"width": canvas[0], "height": canvas[1]},
        "anchor": {"x": ax, "y": ay, "horizontal": "center", "vertical": "foot-bottom"},
        "sharedScale": shared_scale,
        "fps": round(1000 / 140, 3),
        "frames": metadata_frames,
        "outputs": {"gif": gif_path.name, "webp": webp_path.name},
    }
    (output_dir / "working.meta.json").write_text(json.dumps(meta, ensure_ascii=False, indent=2), encoding="utf-8")
    return meta


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("input", type=Path)
    parser.add_argument("output", type=Path)
    args = parser.parse_args()
    meta = normalize(args.input, args.output)
    print(json.dumps(meta, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
