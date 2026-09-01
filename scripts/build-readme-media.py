"""Build privacy-safe README media from the committed runtime action strips."""
from pathlib import Path
import re

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "docs/media"
STRIPS = ROOT / "assets/pet/action-sheets"
TS = (ROOT / "src/client/pet-action-sheets.generated.ts").read_text(encoding="utf-8")
OUT.mkdir(parents=True, exist_ok=True)

ACTIONS = [
    ("idle", "空闲"), ("working", "工作中"), ("eating", "压缩中"), ("digesting", "整理中"),
    ("warning", "上下文预警"), ("evolve", "状态更新"), ("click", "打招呼"), ("archive", "已归档"),
    ("tool-success", "工具完成"), ("tool-failure", "工具失败"),
    ("prompt-enhancing", "提示生成中"), ("prompt-ready", "提示已就绪"),
]
META = re.compile(
    r"frameW: (\d+),\s*frameH: (\d+),\s*bodyHeight: (\d+),\s*feetY: (\d+),"
    r"\s*frames: (\d+),\s*cols: (\d+),\s*rows: (\d+),",
    re.S,
)
FONT_PATH = Path(r"C:\Windows\Fonts\msyh.ttc")
FONT = ImageFont.truetype(str(FONT_PATH), 24) if FONT_PATH.exists() else ImageFont.load_default()
FONT_SM = ImageFont.truetype(str(FONT_PATH), 18) if FONT_PATH.exists() else ImageFont.load_default()
FONT_LG = ImageFont.truetype(str(FONT_PATH), 34) if FONT_PATH.exists() else ImageFont.load_default()


def metadata(action: str):
    start = TS.index(f"'{action}': {{")
    block = TS[start:TS.index("},", start)]
    match = META.search(block)
    if not match:
        raise RuntimeError(f"metadata missing: {action}")
    return tuple(map(int, match.groups()))


def frames(action: str):
    fw, fh, _body, _feet, count, cols, _rows = metadata(action)
    strip = Image.open(STRIPS / f"{action}.webp").convert("RGBA")
    result = []
    for index in range(count):
        col, row = index % cols, index // cols
        result.append(strip.crop((col * fw, row * fh, (col + 1) * fw, (row + 1) * fh)))
    return result


def contain(image: Image.Image, width: int, height: int):
    copy = image.copy()
    copy.thumbnail((width, height), Image.Resampling.LANCZOS)
    return copy

# Individual representative action images.
representatives = {}
for action, label in ACTIONS:
    seq = frames(action)
    representative = contain(seq[min(12, len(seq) - 1)], 220, 220)
    canvas = Image.new("RGBA", (260, 260), (242, 250, 246, 255))
    canvas.alpha_composite(representative, ((260 - representative.width) // 2, 18 + (210 - representative.height) // 2))
    draw = ImageDraw.Draw(canvas)
    box = draw.textbbox((0, 0), label, font=FONT_SM)
    draw.rounded_rectangle((130 - (box[2] - box[0]) // 2 - 12, 226, 130 + (box[2] - box[0]) // 2 + 12, 254), 14, fill=(38, 50, 47, 230))
    draw.text((130 - (box[2] - box[0]) / 2, 229), label, font=FONT_SM, fill=(255, 255, 255, 255))
    path = OUT / f"action-{action}.webp"
    canvas.convert("RGB").save(path, "WEBP", quality=88, method=6)
    representatives[action] = canvas

# 4 x 3 action overview.
overview = Image.new("RGB", (4 * 260 + 5 * 16, 3 * 260 + 4 * 16), (230, 241, 236))
for index, (action, _label) in enumerate(ACTIONS):
    x = 16 + (index % 4) * 276
    y = 16 + (index // 4) * 276
    overview.paste(representatives[action].convert("RGB"), (x, y))
overview.save(OUT / "actions-overview.webp", "WEBP", quality=88, method=6)

# One compact animated demo cycling through all actions.
gif_frames = []
for action, label in ACTIONS:
    seq = frames(action)
    for source_index in (0, 8, 16, 24):
        pet = contain(seq[min(source_index, len(seq) - 1)], 240, 250)
        canvas = Image.new("RGB", (320, 320), (238, 248, 242))
        rgba = canvas.convert("RGBA")
        rgba.alpha_composite(pet, ((320 - pet.width) // 2, 36 + (244 - pet.height) // 2))
        draw = ImageDraw.Draw(rgba)
        box = draw.textbbox((0, 0), label, font=FONT)
        draw.rounded_rectangle((160 - (box[2] - box[0]) // 2 - 16, 10, 160 + (box[2] - box[0]) // 2 + 16, 44), 17, fill=(55, 73, 65, 235))
        draw.text((160 - (box[2] - box[0]) / 2, 12), label, font=FONT, fill="white")
        gif_frames.append(rgba.convert("P", palette=Image.Palette.ADAPTIVE, colors=128))
gif_frames[0].save(OUT / "actions-demo.gif", save_all=True, append_images=gif_frames[1:], duration=180, loop=0, optimize=True, disposal=2)

print(f"wrote README media to {OUT}")
