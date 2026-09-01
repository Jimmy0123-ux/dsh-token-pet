"""KouKouTu async background-removal client (key from HKCU env KKOUTU_API_KEY)."""
import json
import os
import sys
import time
import urllib.error
import urllib.request
import uuid
from pathlib import Path

CREATE = "https://async.koukoutu.com/v1/create"
QUERY = "https://async.koukoutu.com/v1/query"
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120"


def key():
    value = os.environ.get("KKOUTU_API_KEY", "")
    if not value:
        value = __import__("winreg").QueryValueEx(
            __import__("winreg").ConnectRegistry(None, __import__("winreg").HKEY_CURRENT_USER),
            "KKOUTU_API_KEY")[0]
    if not value:
        raise SystemExit("KKOUTU_API_KEY not set in env or HKCU")
    return value


def create_task(image_path, api_key, output_format="png", border=1):
    boundary = "----kk" + uuid.uuid4().hex
    fields = {
        "model_key": "background-removal",
        "output_format": output_format,
        "crop": "0",
        "border": str(border),
        "stamp_crop": "0",
    }
    parts = []
    for name, value in fields.items():
        parts.append(f'--{boundary}\r\nContent-Disposition: form-data; name="{name}"\r\n\r\n{value}\r\n'.encode())
    parts.append(
        f'--{boundary}\r\nContent-Disposition: form-data; name="image_file"; filename="{Path(image_path).name}"\r\nContent-Type: image/png\r\n\r\n'.encode())
    parts.append(Path(image_path).read_bytes())
    parts.append(f'\r\n--{boundary}--\r\n'.encode())
    req = urllib.request.Request(CREATE, data=b"".join(parts), method="POST")
    req.add_header("Authorization", f"Bearer {api_key}")
    req.add_header("Content-Type", f"multipart/form-data; boundary={boundary}")
    req.add_header("User-Agent", UA)
    with urllib.request.urlopen(req, timeout=120) as resp:
        return json.loads(resp.read().decode())


def query_task(task_id, api_key, response="url"):
    boundary = "----kk" + uuid.uuid4().hex
    body = "".join([
        f'--{boundary}\r\nContent-Disposition: form-data; name="task_id"\r\n\r\n{task_id}\r\n',
        f'--{boundary}\r\nContent-Disposition: form-data; name="response"\r\n\r\n{response}\r\n',
        f'--{boundary}--\r\n',
    ]).encode()
    req = urllib.request.Request(QUERY, data=body, method="POST")
    req.add_header("Authorization", f"Bearer {api_key}")
    req.add_header("Content-Type", f"multipart/form-data; boundary={boundary}")
    req.add_header("User-Agent", UA)
    with urllib.request.urlopen(req, timeout=60) as resp:
        return json.loads(resp.read().decode())


def run(image_path, out_path, api_key, output_format="png", border=1, timeout=300):
    created = create_task(image_path, api_key, output_format, border)
    if created.get("code") != 200:
        raise RuntimeError(f"create failed: {created}")
    task_id = created["data"]["task_id"]
    start = time.time()
    while time.time() - start < timeout:
        result = query_task(task_id, api_key)
        if result.get("code") != 200:
            raise RuntimeError(f"query failed: {result}")
        data = result["data"]
        state = data.get("state")
        if state == 1:
            url = data["result_file"]
            req = urllib.request.Request(url, headers={"User-Agent": UA})
            with urllib.request.urlopen(req, timeout=120) as resp:
                out_path.write_bytes(resp.read())
            return {"task_id": task_id, "url": url, "bytes": out_path.stat().st_size}
        time.sleep(3)
    raise RuntimeError(f"timeout on task {task_id}")


if __name__ == "__main__":
    src, dst = Path(sys.argv[1]), Path(sys.argv[2])
    fmt = sys.argv[3] if len(sys.argv) > 3 else "png"
    border = int(sys.argv[4]) if len(sys.argv) > 4 else 1
    print(json.dumps(run(src, dst, key(), fmt, border), indent=2))
