import os, urllib.request, json, uuid, pathlib
base = 'https://ai.t8star.org'
key = os.environ['FARSTAR_ART_API_KEY']
img_data = pathlib.Path(r'H:\ds\dsh-token-pet\assets\qpet\identity\qpet-stage-01-newborn-v02-resident.png').read_bytes()

boundary = '----test' + uuid.uuid4().hex
parts = []
parts.append(f'--{boundary}\r\nContent-Disposition: form-data; name="image"; filename="ref.png"\r\nContent-Type: image/png\r\n\r\n'.encode())
parts.append(img_data)
parts.append(f'\r\n--{boundary}\r\nContent-Disposition: form-data; name="prompt"\r\n\r\ntest'.encode())
parts.append(f'\r\n--{boundary}\r\nContent-Disposition: form-data; name="model"\r\n\r\ngpt-image-2'.encode())
parts.append(f'\r\n--{boundary}\r\nContent-Disposition: form-data; name="n"\r\n\r\n1'.encode())
parts.append(f'\r\n--{boundary}\r\nContent-Disposition: form-data; name="size"\r\n\r\n1024x1024'.encode())
parts.append(f'\r\n--{boundary}--\r\n'.encode())
body = b''.join(parts)
r = urllib.request.Request(base + '/v1/images/edits?async=true', data=body, method='POST')
r.add_header('Authorization', 'Bearer ' + key)
r.add_header('Content-Type', f'multipart/form-data; boundary={boundary}')
try:
    with urllib.request.urlopen(r, timeout=60) as resp:
        print('OK', resp.status, json.loads(resp.read()).get('task_id'))
except Exception as e:
    print('ERR', e)
