# Sprite strip generation + chroma-key pipeline for all 12 QPet actions
# Uses FARSTAR gpt-image-2 gateway to generate 8-frame sprite strips for each action,
# then removes magenta background and saves both raw and transparent versions.
#
# IMPORTANT: This is a long-running batch (12 actions x 8 frames = 96 API calls).
# Each action takes ~8-16 minutes. Total ~2-3 hours.

import os, json, urllib.request, time, pathlib, uuid
import numpy as np
from PIL import Image

BASE = os.environ.get('FARSTAR_IMAGE_BASE_URL', 'https://ai.t8star.org')
KEY = os.environ.get('FARSTAR_ART_API_KEY')

ROOT = pathlib.Path(r'H:\ds\dsh-token-pet')
OUT_ROOT = ROOT / 'Review' / 'h3-actions'
REF_IMG = ROOT / 'assets' / 'qpet' / 'identity' / 'qpet-stage-01-newborn-v02-resident.png'

# ---- ACTION DEFINITIONS ----
# Each action: 8-frame sprite animation with clear visual semantics
ACTIONS = {
    'idle': [
        ("idle-base", "Standing idle pose, eyes open, relaxed, slight breathing."),
        ("idle-inhale", "Same pose, gentle inhale — chest/shoulders rise slightly, eyes open."),
        ("idle-exhale", "Same pose, gentle exhale — chest/shoulders settle back, eyes open."),
        ("idle-blink-half", "Same pose, eyelids half-closed (mid-blink), rest unchanged."),
        ("idle-blink-closed", "Same pose, eyes fully closed (blink), rest unchanged."),
        ("idle-eyes-open", "Same pose, eyes fully open again, returned to base idle."),
        ("idle-look-left", "Same pose, eyes glance left briefly, then look forward again."),
        ("idle-rest", "Same relaxed idle pose, eyes open, ready to repeat."),
    ],
    'working': [
        ("work-start", "Eyes focused forward, both hands raised in front of chest, ready to type."),
        ("work-type-1", "Hands making small typing motions in front of chest, focused expression."),
        ("work-type-2", "Hands in typing motion, fingers slightly different position, focused."),
        ("work-type-3", "Hands typing, slight head tilt as if reading, focused."),
        ("work-type-4", "Hands typing, eyes glance down at invisible screen, focused."),
        ("work-type-5", "Hands typing, slight nod, focused expression."),
        ("work-type-6", "Hands pause, small satisfied smile, then resume position."),
        ("work-rest", "Hands lower, relaxed idle pose, expression serene."),
    ],
    'eating': [
        ("eat-bring", "Hands raised near mouth, holding invisible small glowing item (Token treat)."),
        ("eat-bite", "Mouth open slightly, biting into the treat, happy eyes."),
        ("eat-chew", "Mouth chewing, cheeks puffed slightly, happy expression."),
        ("eat-swallow", "Swallowing, slight satisfied tilt of head, treat fading."),
        ("eat-lick", "Lips licking, content expression."),
        ("eat-satisfied", "Satisfied smile, hands lowering, treat gone."),
        ("eat-burp", "Small surprised burp expression, hand on mouth, cheeks pink."),
        ("eat-rest", "Back to relaxed idle pose, happy satisfied expression."),
    ],
    'digesting': [
        ("digest-stomach", "One hand placed on belly, gentle patting motion."),
        ("digest-pat", "Belly patting continues, eyes closed in contentment."),
        ("digest-rub", "Rubbing belly gently, pleasant expression."),
        ("digest-sigh", "Deep satisfied sigh, eyes half closed, hand on belly."),
        ("digest-glow", "Small green glow bubble appears near belly, soft warm light."),
        ("digest-bubble", "Glow bubble grows slightly, then begins to fade."),
        ("digest-fade", "Bubble fading away, satisfied expression."),
        ("digest-rest", "Back to relaxed idle pose, content smile."),
    ],
    'warning': [
        ("warn-alert", "Eyes widen, sudden alert expression, body tense."),
        ("warn-shake", "Head shaking slightly left-right, worried expression."),
        ("warn-stamp", "One foot stomping slightly, sharp warning expression."),
        ("warn-cross", "Arms crossed in front of chest, serious warning look."),
        ("warn-point", "Pointing forward with one hand, stern warning face."),
        ("warn-stop", "Palm facing forward in stop gesture, firm expression."),
        ("warn-caution", "Yellow caution triangle symbol appears briefly beside character."),
        ("warn-rest", "Warning expression softening back to idle."),
    ],
    'evolve': [
        ("evo-prepare", "Character crouches slightly, eyes closed, gathering energy."),
        ("evo-rise", "Rising up, arms spreading outward, energy aura building."),
        ("evo-burst", "Full upward pose, arms wide, green energy burst around character."),
        ("evo-glow", "Bright green glow emanating from character, triumphant smile."),
        ("evo-shine", "Sparkles and stars surrounding character, peak moment."),
        ("evo-settle", "Arms slowly lowering, sparkle effects fading."),
        ("evo-pose", "Final triumphant pose, one arm raised, confident smile."),
        ("evo-rest", "Back to relaxed idle, satisfied and confident."),
    ],
    'click': [
        ("click-react", "Eyes light up, slight surprised happy expression."),
        ("click-bounce", "Small bounce upward, happy smile forming."),
        ("click-wave", "One hand waving quickly in greeting, big smile."),
        ("click-sparkle", "Heart or sparkle appears near character, happy expression."),
        ("click-blink", "Quick happy blink, sparkle fading."),
        ("click-nod", "Quick happy nod, confident smile."),
        ("click-bow", "Slight bow, polite happy expression."),
        ("click-rest", "Back to relaxed idle, content happy expression."),
    ],
    'archive': [
        ("arch-book-open", "Opening an invisible book/scroll with both hands."),
        ("arch-read", "Reading from the book/scroll, focused expression."),
        ("arch-turn", "Turning a page/scroll section, thoughtful expression."),
        ("arch-think", "Hand on chin, deep in thought, eyes looking up."),
        ("arch-write", "Writing something down quickly, focused."),
        ("arch-stamp", "Stamping/approving something, satisfied nod."),
        ("arch-close", "Closing the book/scroll with both hands."),
        ("arch-rest", "Back to idle, confident accomplished expression."),
    ],
    'tool-success': [
        ("ts-sparkle", "Bright sparkle effect appears, eyes light up."),
        ("ts-celebrate", "Small victory fist pump with one hand, big smile."),
        ("ts-checkmark", "Green checkmark symbol appears briefly beside character."),
        ("ts-confident", "Confident pose, hands on hips, proud smile."),
        ("ts-approve", "Thumbs up gesture, cheerful expression."),
        ("ts-shine", "Character glowing with success, radiating happiness."),
        ("ts-bow", "Humble bow, grateful expression."),
        ("ts-rest", "Back to relaxed idle, satisfied confident expression."),
    ],
    'tool-failure': [
        ("tf-shock", "Eyes widen, surprised expression, slight stumble."),
        ("tf-wince", "Wincing, one hand rubbing back of head, embarrassed."),
        ("tf-sweat", "Sweat drop appears, embarrassed smile."),
        ("tf-downcast", "Eyes looking down, sad expression, shoulders slumped."),
        ("tf-recover", "Taking a deep breath, determined expression."),
        ("tf-shake", "Shaking off the failure, standing up straighter."),
        ("tf-determined", "Determined expression, fists clenched, ready to try again."),
        ("tf-rest", "Back to idle, expression slightly serious but ready."),
    ],
    'prompt_enhancing': [
        ("pe-think", "Hand on chin, deep thinking expression, eyes looking up."),
        ("pe-lightbulb", "Eyes light up, small sparkle near head, idea forming."),
        ("pe-pen", "Writing quickly in air with one hand, focused expression."),
        ("pe-construct", "Both hands building something invisible, focused."),
        ("pe-polish", "Polishing/refining something, careful expression."),
        ("pe-refine", "Refining details, intense focus."),
        ("pe-complete", "Finished, holding up result proudly."),
        ("pe-rest", "Back to relaxed idle, ready to assist."),
    ],
    'prompt_ready': [
        ("pr-alert", "Eyes brighten, alert and ready expression."),
        ("pr-stand", "Standing up straighter, energized expression."),
        ("pr-hands-up", "Both hands raised slightly, ready to help."),
        ("pr-smile", "Warm friendly smile, inviting expression."),
        ("pr-present", "Presenting gesture, 'ready to help' expression."),
        ("pr-nod", "Confident nod, eager expression."),
        ("pr-sparkle", "Small sparkle near character, ready to go."),
        ("pr-rest", "Back to idle, but with a subtle 'ready' quality."),
    ],
}

# ---- API HELPERS ----
def api(method, path, data=None, headers=None, timeout=60):
    r = urllib.request.Request(BASE + path, data=data, method=method)
    r.add_header('Authorization', f'Bearer {KEY}')
    if headers:
        for k, v in headers.items(): r.add_header(k, v)
    with urllib.request.urlopen(r, timeout=timeout) as resp:
        return resp.read()

def poll(task_id, timeout=300):
    start = time.time()
    while time.time() - start < timeout:
        try:
            j = json.loads(api('GET', f'/v1/images/tasks/{task_id}', timeout=30))
            d = j.get('data') or {}
            status = d.get('status') or j.get('status')
            if status in ('SUCCESS', 'success', 'completed'):
                return j
            if status in ('FAILURE', 'failure', 'FAILED', 'error', 'canceled', 'cancelled'):
                print(f'  FAILED: {d.get("fail_reason")}', flush=True)
                return j
        except Exception as e:
            print(f'  poll err: {e}', flush=True)
        time.sleep(8)
    return None

def download_url(url):
    r = urllib.request.Request(url)
    r.add_header('User-Agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36')
    with urllib.request.urlopen(r, timeout=60) as resp:
        return resp.read()

def find_urls(obj, out=None):
    if out is None: out = []
    if isinstance(obj, dict):
        for v in obj.values(): find_urls(v, out)
    elif isinstance(obj, list):
        for v in obj: find_urls(v, out)
    elif isinstance(obj, str) and 'aiproxy.vip' in obj:
        out.append(obj)
    return out

# ---- GENERATION ----
def generate_frame(action_name, frame_idx, pose_desc, img_data):
    prompt = (
        f'Character design reference sheet style, single full-body character, front-facing, '
        f'centered in frame, full body visible from head to boots. '
        f'EXACT character from reference: same face, same hairstyle with large ahoge curl and '
        f'leaf hairpin, same long flowing green hair, same green eyes, same green dress with leaf '
        f'emblem, same green boots. '
        f'This is frame {frame_idx+1} of 8 of the "{action_name}" action animation. {pose_desc} '
        f'Character size and position must be EXACTLY consistent with all other frames. '
        f'No shadows, no ground, no floor. Solid MAGENTA (#FF00FF) flat background, zero variation. '
        f'No text, no watermark, no frame number, no grid lines.'
    )
    boundary = '----form' + uuid.uuid4().hex
    parts = []
    parts.append(f'--{boundary}\r\nContent-Disposition: form-data; name="image"; filename="ref.png"\r\nContent-Type: image/png\r\n\r\n'.encode())
    parts.append(img_data)
    parts.append(f'\r\n--{boundary}\r\nContent-Disposition: form-data; name="prompt"\r\n\r\n{prompt}'.encode())
    parts.append(f'\r\n--{boundary}\r\nContent-Disposition: form-data; name="model"\r\n\r\ngpt-image-2'.encode())
    parts.append(f'\r\n--{boundary}\r\nContent-Disposition: form-data; name="n"\r\n\r\n1'.encode())
    parts.append(f'\r\n--{boundary}\r\nContent-Disposition: form-data; name="size"\r\n\r\n1024x1024'.encode())
    parts.append(f'\r\n--{boundary}--\r\n'.encode())
    body = b''.join(parts)
    raw = api('POST', '/v1/images/edits?async=true', data=body,
              headers={'Content-Type': f'multipart/form-data; boundary={boundary}'}, timeout=60)
    j = json.loads(raw)
    return j.get('task_id') or j.get('id') or (j.get('data') or {}).get('id')

# ---- CHROMA KEY ----
def remove_magenta(img, hard_thresh=80, feather_thresh=130, despill_strength=0.85):
    arr = np.array(img).astype(float)
    rgb = arr[:, :, :3]
    MAGENTA = np.array([255, 0, 255], dtype=np.float32)
    dist = np.sqrt(np.sum((rgb - MAGENTA) ** 2, axis=2))
    alpha = np.where(dist <= hard_thresh, 0.0,
             np.where(dist >= feather_thresh, 255.0,
                      255.0 * (dist - hard_thresh) / (feather_thresh - hard_thresh)))
    alpha = np.clip(alpha, 0, 255).astype(np.uint8)
    rb = rgb[:, :, 0] + rgb[:, :, 2]
    g = rgb[:, :, 1]
    mag_score = np.clip((rb - 2 * g) / 255.0, 0, 1)
    despill = mag_score * despill_strength
    r = rgb[:, :, 0] - despill * (rgb[:, :, 0] - rgb[:, :, 1])
    b = rgb[:, :, 2] - despill * (rgb[:, :, 2] - rgb[:, :, 1])
    rgb_clean = np.clip(np.stack([r, g, b], axis=2), 0, 255).astype(np.uint8)
    return Image.fromarray(np.dstack([rgb_clean, alpha[:, :, np.newaxis]]).astype(np.uint8), 'RGBA')

def compose_strip(frames, cell_size=1024):
    strip = Image.new('RGBA', (cell_size * len(frames), cell_size), (0, 0, 0, 0))
    for i, f in enumerate(frames):
        if f.size != (cell_size, cell_size):
            f = f.resize((cell_size, cell_size), Image.Resampling.LANCZOS)
        if f.mode == 'RGBA':
            strip.paste(f, (i * cell_size, 0), f)
        else:
            strip.paste(f, (i * cell_size, 0))
    return strip

# ---- MAIN ----
def main():
    img_data = REF_IMG.read_bytes()
    total_actions = len(ACTIONS)
    action_list = list(ACTIONS.items())

    for ai, (action_name, frames_def) in enumerate(action_list):
        print(f'\n=== [{ai+1}/{total_actions}] ACTION: {action_name} ===', flush=True)
        action_dir = OUT_ROOT / action_name
        raw_dir = action_dir / 'frames-raw'       # magenta bg raw frames
        transparent_dir = action_dir / 'frames-transparent'

        raw_dir.mkdir(parents=True, exist_ok=True)
        transparent_dir.mkdir(parents=True, exist_ok=True)

        # Submit all 8 frames for this action
        tasks = []
        for fi, (frame_name, pose_desc) in enumerate(frames_def):
            tid = generate_frame(action_name, fi, pose_desc, img_data)
            print(f'  Frame {fi} ({frame_name}): task_id={tid}', flush=True)
            tasks.append((fi, frame_name, tid))
            time.sleep(1)

        # Poll and download
        for fi, frame_name, tid in tasks:
            print(f'  Waiting frame {fi}...', flush=True)
            result = poll(tid, timeout=300)
            if result is None:
                print(f'  TIMEOUT frame {fi}', flush=True)
                continue
            d = result.get('data') or {}
            status = d.get('status') or result.get('status')
            if status not in ('SUCCESS', 'success', 'completed'):
                print(f'  FAILED frame {fi}: {d.get("fail_reason")}', flush=True)
                continue
            urls = find_urls(result)
            if not urls:
                print(f'  No URL frame {fi}', flush=True)
                continue
            raw_data = download_url(urls[0])
            # Save raw (magenta bg)
            raw_path = raw_dir / f'{fi:02d}-{frame_name}.png'
            raw_path.write_bytes(raw_data)
            print(f'  Raw: {raw_path.name} ({len(raw_data)//1024}KB)', flush=True)
            # Chroma-key and save transparent
            img = Image.open(raw_path).convert('RGB')
            transparent = remove_magenta(img)
            transparent_path = transparent_dir / f'{fi:02d}-{frame_name}.png'
            transparent.save(transparent_path)

        # Compose sprite strips (both raw and transparent)
        raw_frames = [Image.open(f) for f in sorted(raw_dir.glob('*.png'))]
        trans_frames = [Image.open(f) for f in sorted(transparent_dir.glob('*.png'))]

        if raw_frames:
            raw_strip = compose_strip(raw_frames)
            raw_strip.save(action_dir / f'{action_name}-raw-strip.png')
            print(f'  Raw strip: {action_dir / f"{action_name}-raw-strip.png"} ({raw_strip.size[0]}x{raw_strip.size[1]})', flush=True)

        if trans_frames:
            trans_strip = compose_strip(trans_frames)
            trans_strip.save(action_dir / f'{action_name}-transparent-strip.png')
            print(f'  Transparent strip: {action_dir / f"{action_name}-transparent-strip.png"} ({trans_strip.size[0]}x{trans_strip.size[1]})', flush=True)

        print(f'  {action_name} COMPLETE', flush=True)

    print('\n=== ALL 12 ACTIONS DONE ===', flush=True)
    # Summary
    for action_name in ACTIONS:
        action_dir = OUT_ROOT / action_name
        raw_strip = action_dir / f'{action_name}-raw-strip.png'
        trans_strip = action_dir / f'{action_name}-transparent-strip.png'
        raw_ok = raw_strip.exists()
        trans_ok = trans_strip.exists()
        print(f'  {action_name}: raw={raw_ok} transparent={trans_ok}', flush=True)

if __name__ == '__main__':
    main()
