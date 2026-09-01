"""Regenerate archive and working actions with smooth, coherent frame sequences.
Each action should be a subtle, continuous motion — small variations of the same base pose,
like idle (breathing + blink), not 8 completely different poses."""
import os, json, urllib.request, time, pathlib, uuid
import numpy as np
from PIL import Image

BASE = os.environ.get('FARSTAR_IMAGE_BASE_URL', 'https://ai.t8star.org')
KEY = os.environ.get('FARSTAR_ART_API_KEY')

ROOT = pathlib.Path(r'H:\ds\dsh-token-pet')
OUT_ROOT = ROOT / 'Review' / 'h3-actions'
REF_IMG = ROOT / 'assets' / 'qpet' / 'identity' / 'qpet-stage-01-newborn-v02-resident.png'

# Smooth, coherent frame definitions — each frame is a tiny variation of the SAME base pose
# (like idle: base stance + breathing + blink, not 8 different poses)
ACTIONS = {
    'working': [
        ("base-eyes-open", "Standing at relaxed attention, eyes open, hands resting at sides, gentle breathing."),
        ("hands-raised", "Eyes open, both hands raised slightly to chest height as if at a keyboard, subtle typing motion."),
        ("typing-1", "Hands at keyboard height, eyes focused forward, fingers pressing down in typing motion, focused expression."),
        ("typing-2", "Same typing pose, fingers in slightly different position, eyes still focused forward, small head tilt."),
        ("typing-3", "Same typing pose, eyes glance down briefly at keyboard, hands continue typing."),
        ("typing-4", "Same typing pose, eyes look back up at screen, small satisfied nod."),
        ("hands-lower", "Eyes open, hands lowering back toward sides, starting to relax."),
        ("rest", "Back to standing relaxed pose, eyes open, same as frame 0, ready to loop."),
    ],
    'archive': [
        ("base-eyes-open", "Standing relaxed, eyes open, hands at sides, breathing gently."),
        ("hands-at-chest", "Both hands raised to chest level, holding an invisible scroll/book gently."),
        ("reading", "Looking down at the scroll/book in hands, focused reading expression, body slightly leaned forward."),
        ("turn-page", "One hand turning a page of the scroll, eyes still reading, slight movement."),
        ("finish-reading", "Looking up from scroll, thoughtful satisfied expression, scroll still in hands."),
        ("close-scroll", "Both hands closing/rolling up the scroll, putting it away."),
        ("hands-return", "Hands moving back toward sides, still holding slightly, satisfied expression."),
        ("rest", "Back to standing relaxed pose, hands at sides, eyes open, ready to loop."),
    ],
}

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
            if status in ('SUCCESS', 'success', 'completed'): return j
            if status in ('FAILURE', 'failure', 'FAILED', 'error', 'canceled', 'cancelled'):
                print(f'  FAILED: {d.get("fail_reason")}', flush=True); return j
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

def generate_frame(action_name, frame_idx, pose_desc, img_data):
    prompt = (
        f'Character design reference sheet style, single full-body character, front-facing, '
        f'centered in frame, full body visible from head to boots. '
        f'EXACT character from reference: same face, same hairstyle with large ahoge curl and '
        f'leaf hairpin, same long flowing green hair, same green eyes, same green dress with leaf '
        f'emblem, same green boots. '
        f'This is frame {frame_idx+1} of 8 of the "{action_name}" action animation. {pose_desc} '
        f'Character size and position must be EXACTLY consistent with all other frames — same height, same width, same center. '
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

def remove_magenta(img, hard=80, feather=130, despill=0.85):
    arr = np.array(img).astype(float)
    rgb = arr[:,:,:3]
    MAGENTA = np.array([255,0,255], dtype=np.float32)
    dist = np.sqrt(((rgb - MAGENTA)**2).sum(axis=2))
    alpha = np.where(dist<=hard, 0.0, np.where(dist>=feather, 255.0, 255.0*(dist-hard)/(feather-hard)))
    alpha = np.clip(alpha,0,255).astype(np.uint8)
    rb = rgb[:,:,0]+rgb[:,:,2]; g = rgb[:,:,1]
    mag = np.clip((rb-2*g)/255.0,0,1)
    d = mag*despill
    r = rgb[:,:,0]-d*(rgb[:,:,0]-g); b = rgb[:,:,2]-d*(rgb[:,:,2]-g)
    clean = np.clip(np.stack([r,g,b],axis=2),0,255).astype(np.uint8)
    return Image.fromarray(np.dstack([clean,alpha[:,:,np.newaxis]]).astype(np.uint8),'RGBA')

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

def main():
    img_data = REF_IMG.read_bytes()
    for action_name, frames_def in ACTIONS.items():
        print(f'\n=== ACTION: {action_name} ===', flush=True)
        action_dir = OUT_ROOT / action_name
        raw_dir = action_dir / 'frames-raw'
        transparent_dir = action_dir / 'frames-transparent'
        raw_dir.mkdir(parents=True, exist_ok=True)
        transparent_dir.mkdir(parents=True, exist_ok=True)

        # Submit all 8 frames
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
                print(f'  TIMEOUT frame {fi}', flush=True); continue
            d = result.get('data') or {}
            status = d.get('status') or result.get('status')
            if status not in ('SUCCESS', 'success', 'completed'):
                print(f'  FAILED frame {fi}: {d.get("fail_reason")}', flush=True); continue
            urls = find_urls(result)
            if not urls:
                print(f'  No URL frame {fi}', flush=True); continue
            raw_data = download_url(urls[0])
            raw_path = raw_dir / f'{fi:02d}-{frame_name}.png'
            raw_path.write_bytes(raw_data)
            print(f'  Raw: {raw_path.name} ({len(raw_data)//1024}KB)', flush=True)
            transparent = remove_magenta(Image.open(raw_path).convert('RGB'))
            transparent.save(transparent_dir / f'{fi:02d}-{frame_name}.png')

        # Compose strips
        raw_frames = [Image.open(f) for f in sorted(raw_dir.glob('*.png'))]
        trans_frames = [Image.open(f) for f in sorted(transparent_dir.glob('*.png'))]
        if raw_frames:
            compose_strip(raw_frames).save(action_dir / f'{action_name}-raw-strip.png')
        if trans_frames:
            compose_strip(trans_frames).save(action_dir / f'{action_name}-transparent-strip.png')
        print(f'  {action_name} DONE', flush=True)

    print('\n=== DONE ===', flush=True)

if __name__ == '__main__':
    main()
