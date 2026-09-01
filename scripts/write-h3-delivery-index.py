"""Write consolidated H3 delivery index after final technical/content QA."""
from pathlib import Path
import hashlib
import json
import os

ROOT = Path(r"H:\ds\dsh-token-pet")
ACTION_ROOT = ROOT / "Review/h3-actions"
VERSION = os.environ.get("H3_DELIVERY_VERSION", "v05")
QA_LABEL = os.environ.get("H3_QA_LABEL", f"qa-{VERSION}-final-batch")
TECH = json.loads((ACTION_ROOT / QA_LABEL / "technical-report.json").read_text(encoding="utf-8"))
ACTIONS = [
    "idle", "working", "eating", "digesting", "warning", "evolve",
    "click", "archive", "tool-success", "tool-failure",
    "prompt-enhancing", "prompt-ready",
]
CANONICAL = ROOT / "assets/qpet/identity/qpet-stage-01-newborn-v02-resident.png"
REFERENCE = ACTION_ROOT / "references/qpet-v15-resident-magenta-864x480.png"

CONTENT_NOTES = {
    "idle": "pass: fixed front full-body identity, subtle idle change, clean full-frame magenta",
    "working": "pass: continuous small air-operation gesture; no computer, keyboard, screen, desk or phone",
    "eating": "pass: single crisp round token cookie remains readable and disappears at the mouth",
    "digesting": "pass: clear hand-to-belly gesture with contained small glow",
    "warning": "pass: continuous raise-hold-lower stop palm; fixed warning mark; full-frame magenta",
    "evolve": "pass: ring and leaves remain within the character safe zone and never touch screen edges",
    "click": "pass: one wave/blink response with a small contained click ring",
    "archive": "pass: three crisp leaf points gather to center and disappear; no book/card/background change",
    "tool-success": "pass: clear thumbs-up, happy nod, no external prop or icon",
    "tool-failure": "pass: forearms cross into an X body gesture, then recover; no external icon",
    "prompt-enhancing": "pass: crisp small dot/leaf ring between hands, full-frame magenta, no held object blur",
    "prompt-ready": "pass: clear fixed leaf symbol between open palms, contained and readable",
}

items = []
for action in ACTIONS:
    video = ACTION_ROOT / action / f"{action}-{VERSION}-nosr.mp4"
    tech = TECH["actions"][action]
    items.append({
        "action": action,
        "video": str(video.relative_to(ROOT)).replace("\\", "/"),
        "sha256": hashlib.sha256(video.read_bytes()).hexdigest(),
        "bytes": video.stat().st_size,
        "durationSeconds": tech["duration"],
        "resolution": [tech["videoStream"]["width"], tech["videoStream"]["height"]],
        "fps": tech["videoStream"]["r_frame_rate"],
        "technicalOk": tech["technicalOk"],
        "contentQa": CONTENT_NOTES[action],
        "request": f"Review/h3-actions/{action}/request.{VERSION}.json",
        "history": f"Review/h3-actions/{action}/history.{VERSION}.json",
        "technical": f"Review/h3-actions/{action}/technical.{VERSION}.json",
    })

index = {
    "schemaVersion": 1,
    "candidateVersion": VERSION,
    "status": "generated-technical-and-content-pass-awaiting-user-frame-slicing",
    "template": "U04-minimax_h3_light2v-5图参考生视频加速版",
    "apiWorkflow": "Review/workflows/h3/u04-api.json",
    "nativeResolution": [864, 480],
    "canonicalIdentity": {
        "path": str(CANONICAL.relative_to(ROOT)).replace("\\", "/"),
        "sha256": hashlib.sha256(CANONICAL.read_bytes()).hexdigest(),
    },
    "generationReference": {
        "path": str(REFERENCE.relative_to(ROOT)).replace("\\", "/"),
        "sha256": hashlib.sha256(REFERENCE.read_bytes()).hexdigest(),
        "note": "deterministic 864x480 full-magenta derivative; canonical character pixels unchanged",
    },
    "previousBatches": {
        "v03Archived": "Review/h3-video-archive/v03/archive-index.json",
        "v04": "deleted by explicit user request",
    },
    "qa": {
        "technicalReport": f"Review/h3-actions/{QA_LABEL}/technical-report.json",
        "contactSheets": [f"Review/h3-actions/{QA_LABEL}/contact-{i}.jpg" for i in range(1, 5)],
        "transparentProcessing": "pending user frame slicing; assistant will apply adaptive border-connected chroma extraction and preserve contained action effects",
    },
    "actions": items,
}

out = ACTION_ROOT / f"delivery-index.{VERSION}.json"
out.write_text(json.dumps(index, ensure_ascii=False, indent=2), encoding="utf-8")
print(out)
print("actions", len(items))
print("allTechnicalOk", all(item["technicalOk"] for item in items))
