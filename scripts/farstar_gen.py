import os, json, sys, time, base64, pathlib
import urllib.request, urllib.error

BASE = os.environ.get('FARSTAR_IMAGE_BASE_URL', 'https://ai.t8star.org')
KEY = os.environ.get('FARSTAR_ART_API_KEY')
if not KEY:
    sys.exit('FARSTAR_ART_API_KEY not set')

OUT = pathlib.Path(r'H:\ds\dsh-token-pet\Review\adult-redesign')
OUT.mkdir(parents=True, exist_ok=True)
TASKFILE = OUT / '_task_id.txt'

RESUME = len(sys.argv) > 1 and sys.argv[1] == 'resume'
SUFFIX = sys.argv[2] if len(sys.argv) > 2 else 'v01'
# Optional: a plain-text file containing the prompt (overrides the built-in PROMPT).
PROMPT_FILE = sys.argv[3] if len(sys.argv) > 3 else None

if PROMPT_FILE and pathlib.Path(PROMPT_FILE).exists():
    PROMPT = pathlib.Path(PROMPT_FILE).read_text(encoding='utf-8').strip()
else:
    PROMPT = (
        "Full-body front-facing character design reference of an adult anime woman. "
        "Clean crisp line art, soft cel shading. "
        "BACKGROUND: a clean solid pure-white (#FFFFFF) flat background, NO checkerboard, "
        "NO gradient, NO vignette, NO floor line, NO shadow under the feet, NO silhouette. "
        "Only retained identity trait: long flowing mint-green hair with a soft ahoge curl on top. "
        "Otherwise a completely fresh, elegant adult design. "
        "Outfit: elegant BLACK sexy office-lady (OL) ensemble — a fitted black blazer over a "
        "black high-neck top with a modest neckline opening, a short black pencil skirt, and a "
        "thin black waist belt, mature and chic. "
        "Sheer BLACK stockings covering the full leg from thigh down to the foot. "
        "Black MARY-JANE kitten heels with a delicate instep strap across the top of the foot, "
        "black closed pointed toe, slim heel — refined and elegant. "
        "Long legs, graceful adult proportions, not chibi, not child. "
        "Standing upright, arms relaxed at sides, facing camera directly, legs together, "
        "symmetrical front view, full body fully in frame, body centered with generous margin. "
        "Mature, serene, confident expression. "
        "High-quality anime illustration, 2D game sprite / character-sheet aesthetic. "
        "No armour, no props, no text, no watermark, no signature, no border."
    )

body = {"model": "gpt-image-2", "prompt": PROMPT, "n": 1, "size": "1024x1024"}

def req(method, url, payload=None, timeout=60):
    data = json.dumps(payload).encode('utf-8') if payload is not None else None
    r = urllib.request.Request(url, data=data, method=method)
    r.add_header('Authorization', f'Bearer {KEY}')
    if data is not None:
        r.add_header('Content-Type', 'application/json')
    with urllib.request.urlopen(r, timeout=timeout) as resp:
        raw = resp.read()
        try:
            return json.loads(raw.decode('utf-8'))
        except Exception:
            return raw.decode('utf-8', 'ignore')

def poll(task_id, timeout=420):
    start = time.time()
    while time.time() - start < timeout:
        try:
            j = req('GET', f'{BASE}/v1/images/tasks/{task_id}', timeout=30)
            if isinstance(j, dict):
                data = j.get('data') or {}
                status = j.get('status') or j.get('state') or data.get('status') or data.get('state')
                print('poll:', status, data.get('progress') or '', flush=True)
                if status in ('SUCCESS', 'success', 'completed', 'succeeded', 'FAILED', 'failed', 'error', 'canceled', 'cancelled'):
                    return j
        except urllib.error.HTTPError as e:
            print('poll HTTPError', e.code, flush=True)
        except Exception as e:
            print('poll err', e, flush=True)
        time.sleep(6)
    return None

def find_url(o, out=None):
    if out is None:
        out = []
    if isinstance(o, dict):
        for k, v in o.items():
            find_url(v, out)
    elif isinstance(o, list):
        for v in o:
            find_url(v, out)
    elif isinstance(o, str) and 'aiproxy.vip' in o:
        out.append(o)
    return out

def download(url, ua=True):
    r = urllib.request.Request(url)
    if ua:
        r.add_header('User-Agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36')
    with urllib.request.urlopen(r, timeout=60) as resp:
        return resp.read()

def main():
    task_id = None
    if not RESUME:
        try:
            j = req('POST', f'{BASE}/v1/images/generations?async=true', body)
            print('submit:', json.dumps(j)[:400], flush=True)
        except urllib.error.HTTPError as e:
            print('HTTPError', e.code, e.read().decode('utf-8', 'ignore')[:600], flush=True)
            sys.exit(1)
        task_id = (j.get('id') or j.get('task_id') or (j.get('data') or {}).get('id'))
        if task_id:
            TASKFILE.write_text(str(task_id), encoding='utf-8')
    else:
        if TASKFILE.exists():
            task_id = TASKFILE.read_text(encoding='utf-8').strip()
    if not task_id:
        print('no task id', flush=True); sys.exit(2)
    print('task id', task_id, flush=True)
    result = poll(task_id)
    if result is None:
        print('poll timeout', flush=True); sys.exit(3)
    print('final status', (result.get('data') or {}).get('status'), flush=True)
    urls = find_url(result)
    print('urls', urls, flush=True)
    saved = []
    for i, u in enumerate(urls):
        try:
            raw = download(u)
            p = OUT / f'adult-front-{SUFFIX}-cand-{i}.png'
            p.write_bytes(raw)
            saved.append(str(p))
        except Exception as e:
            print('dl err', u, e, flush=True)
    print('saved', saved, flush=True)
    if not saved:
        print('full:', json.dumps(result)[:1500], flush=True)

if __name__ == '__main__':
    main()
