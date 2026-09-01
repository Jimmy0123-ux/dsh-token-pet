"""Write consolidated v04 H3 delivery index after technical/content QA."""
from pathlib import Path
import hashlib
import json

ROOT = Path(r"H:\ds\dsh-token-pet")
ACTION_ROOT = ROOT / "Review/h3-actions"
TECH = json.loads((ACTION_ROOT / "qa-v04-batch/technical-report.json").read_text(encoding="utf-8"))
ACTIONS = [
    "idle", "working", "eating", "digesting", "warning", "evolve",
    "click", "archive", "tool-success", "tool-failure",
    "prompt-enhancing", "prompt-ready",
]
CANONICAL = ROOT / "assets/qpet/identity/qpet-stage-01-newborn-v02-resident.png"
REFERENCE = ACTION_ROOT / "references/qpet-v15-resident-magenta.png"

content_notes = {
    "idle": "pass: fixed front full-body identity; subtle blink/idle change; pink-magenta background, no shadow",
    "working": "pass: small air-operation hand motion; no computer, keyboard, screen, desk or phone",
    "eating": "pass: hands bring a small treat to mouth; state is clearly readable",
    "digesting": "pass: both hands settle at belly with relaxed satisfied expression",
    "warning": "pass: raised stop palm and red warning triangle are clearly readable",
    "evolve": "pass-with-note: celebration leaf/ring burst is large at peak and must be preserved during alpha extraction",
    "click": "pass-with-note: wave/blink is readable; white side margins coexist with magenta and require adaptive border-key extraction",
    "archive": "pass-with-note: continuous gather-and-fold hand gesture; cards are subtle, so state reads mainly from the collecting motion",
    "tool-success": "pass: bright smile and small two-hand celebration; no persistent tool prop",
    "tool-failure": "pass: large red-orange X is clear and fully disappears by the end",
    "prompt-enhancing": "pass-with-note: leaf-orb refinement gesture is clear; background rendered white instead of magenta and requires white flood-fill extraction",
    "prompt-ready": "pass: hands present forward with clear ready expression",
}

items = []
for action in ACTIONS:
    video = ACTION_ROOT / action / f"{action}-v04-nosr.mp4"
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
        "contentQa": content_notes[action],
        "request": f"Review/h3-actions/{action}/request.v04.json",
        "history": f"Review/h3-actions/{action}/history.v04.json",
        "technical": f"Review/h3-actions/{action}/technical.v04.json",
    })

index = {
    "schemaVersion": 1,
    "candidateVersion": "v04",
    "status": "generated-technical-pass-awaiting-user-frame-slicing",
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
        "note": "deterministic border-connected white-to-magenta derivative; canonical identity pixels unchanged",
    },
    "archivedPreviousBatch": "Review/h3-video-archive/v03/archive-index.json",
    "qa": {
        "technicalReport": "Review/h3-actions/qa-v04-batch/technical-report.json",
        "contactSheets": [f"Review/h3-actions/qa-v04-batch/contact-{i}.jpg" for i in range(1, 5)],
        "transparentProcessing": "pending user frame slicing; assistant will apply adaptive border-connected magenta/white key and preserve action effects",
    },
    "actions": items,
}

out = ACTION_ROOT / "delivery-index.v04.json"
out.write_text(json.dumps(index, ensure_ascii=False, indent=2), encoding="utf-8")
print(out)
print("actions", len(items))
print("allTechnicalOk", all(item["technicalOk"] for item in items))
