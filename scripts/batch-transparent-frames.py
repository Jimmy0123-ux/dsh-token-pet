"""Batch transparency for every action's matted_frames zip.

Pipeline per frame (identical to the approved idle sample):
  1. sprite-gen white position matte (low tolerance, no erosion)
  2. near-white component cleanup with skin + central-lace restoration
  3. floor-shadow removal + small bottom remnant cleanup

Effects (upper sparkles, stars, rings) are preserved: only bottom-12%
disconnected remnants are deleted, and the central-lace restore band is
strictly around the leg region.
"""
from pathlib import Path
import json
import shutil
import subprocess
import sys

ROOT = Path(r"H:\ds\dsh-token-pet")
ACTION_ROOT = ROOT / "Review/h3-actions"
SKILL_PY = Path(r"C:\Users\Administrator.CHINAMI-LGIVRJF\.agents\skills\sprite-gen\.venv\Scripts\python.exe")
SPRITE_GEN = Path(r"C:\Users\Administrator.CHINAMI-LGIVRJF\.agents\skills\sprite-gen\.venv\Scripts\sprite-gen.exe")
CLEANUP = ROOT / "scripts/cleanup-white-matte.py"
SHADOW = ROOT / "scripts/remove-floor-shadow.py"
GLOW_KEY = ROOT / "scripts/glow-key-frames.py"
TEMP = Path(r"C:\Users\Administrator.CHINAMI-LGIVRJF\AppData\Local\Temp\dsh-matted-batch")
# Frames whose background is a big white glow instead of flat white need the
# border-relaxed luminance key; the flat-white matte would leave the glow.
GLOW_ACTIONS = {"evolve", "tool-success", "tool-failure"}

zips = sorted(ACTION_ROOT.glob("*/matted_frames (2).zip"))
if not zips:
    raise SystemExit("no matted_frames zips found")

overall = []
if TEMP.exists():
    shutil.rmtree(TEMP, ignore_errors=True)
TEMP.mkdir(parents=True)

for zip_path in zips:
    action = zip_path.parent.name
    extract = TEMP / action
    if extract.exists():
        shutil.rmtree(extract)
    subprocess.run(
        ["powershell", "-NoProfile", "-Command",
         f"Expand-Archive -LiteralPath '{zip_path}' -DestinationPath '{extract}' -Force"],
        check=True, timeout=300)
    frames_dir = next((p for p in extract.rglob("*") if p.is_dir() and p.name == "matted_frames"), None)
    if frames_dir is None:
        raise SystemExit(f"matted_frames dir missing in {zip_path}")
    frames = sorted(frames_dir.glob("*.png"))
    out_dir = ACTION_ROOT / action / "transparent_frames"
    out_dir.mkdir(parents=True, exist_ok=True)
    glow = action in GLOW_ACTIONS

    stats = []
    for frame in frames:
        final = out_dir / frame.name
        if glow:
            subprocess.run([str(SKILL_PY), str(GLOW_KEY), str(frame), str(final), "232"],
                           check=True, capture_output=True, timeout=900)
        else:
            base = TEMP / f"{action}-base.png"
            clean = TEMP / f"{action}-clean.png"
            subprocess.run([str(SPRITE_GEN), "cutout", str(frame), "--out", str(base),
                            "--key", "white", "--strength", "0", "--band", "16",
                            "--erode", "0", "--tolerance", "26"],
                           check=True, capture_output=True, timeout=600)
            subprocess.run([str(SKILL_PY), str(CLEANUP), str(frame), str(base), str(clean)],
                           check=True, capture_output=True, timeout=600)
            subprocess.run([str(SKILL_PY), str(SHADOW), str(clean), str(final)],
                           check=True, capture_output=True, timeout=600)
            base.unlink(missing_ok=True)
            clean.unlink(missing_ok=True)
        stats.append(frame.name)
        print(f"{action}/{frame.name}", flush=True)

    report = {
        "action": action,
        "source": zip_path.name,
        "frames": len(stats),
        "pipeline": (
            ["glow-key-frames.py (border-relaxed luminance key)",
             "cleanup-white-matte.py (skin + central lace restore)",
             "remove-floor-shadow.py (bottom remnants only)"] if glow else [
            "sprite-gen cutout --key white --strength 0 --band 16 --erode 0 --tolerance 26",
            "cleanup-white-matte.py (skin + central lace restore)",
            "remove-floor-shadow.py (bottom remnants only)"]),
        "files": stats,
    }
    (out_dir / "transparency-report.json").write_text(
        json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    overall.append({"action": action, "frames": len(stats), "pipeline": "glow" if glow else "flat-white"})
    shutil.rmtree(extract, ignore_errors=True)
    print(f"=== {action}: {len(stats)} frames done ===", flush=True)

shutil.rmtree(TEMP, ignore_errors=True)
print(json.dumps(overall, ensure_ascii=False, indent=2))
