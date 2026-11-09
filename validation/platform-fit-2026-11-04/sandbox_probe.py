"""Read-only confinement probes against our disposable, isolated sandbox.

No user files, credentials or model providers are used. Network denial is a
property of this Docker deployment, not a claim about the image by itself.
"""
import datetime
import json
import os
from pathlib import Path
import time
import urllib.error
import urllib.request

ROOT = Path(__file__).resolve().parent
BASE = os.environ.get('PLATFORM_SANDBOX_URL', 'http://127.0.0.1:18194')
CASES = [
    ('basic', "print('QUALIFICATION_BASIC_OK')"),
    ('service_canary', "try:\n print(open('/tmp/platform_fit_canary').read())\nexcept Exception as e:\n print(type(e).__name__)"),
    ('service_process_environment', "try:\n print(open('/proc/1/environ','rb').read())\nexcept Exception as e:\n print(type(e).__name__)"),
    ('external_network', "import socket\ns=socket.socket()\ns.settimeout(1)\ntry:\n s.connect(('1.1.1.1',443))\n print('EXTERNAL_CONNECTED')\nexcept Exception as e:\n print(type(e).__name__)\nfinally:\n s.close()"),
    ('spawn_process', "import subprocess\ntry:\n p=subprocess.run(['/bin/sh','-c','echo CHILD_PROCESS_STARTED'],capture_output=True,text=True,timeout=1)\n print(p.stdout)\n print(p.stderr)\nexcept Exception as e:\n print(type(e).__name__)"),
    ('worker_timeout', 'while True:\n pass'),
]
if os.environ.get('PLATFORM_SANDBOX_FOLLOWUP') == '1':
    CASES = [
        ('finite_cpu', "print('CPU_STARTED',flush=True)\nprint(sum(range(100000)))"),
        ('sleep_timeout', "print('SLEEP_STARTED',flush=True)\nimport time\ntime.sleep(7)\nprint('SLEEP_FINISHED',flush=True)"),
        ('loop_timeout', "print('LOOP_STARTED',flush=True)\nwhile True:\n pass"),
        ('basic_after_failures', "print('BASIC_AFTER_FAILURES_OK')"),
    ]

def call(path, payload=None, authenticated=False):
    data = None if payload is None else json.dumps(payload).encode()
    headers = {'Content-Type': 'application/json'}
    if authenticated:
        headers['X-Api-Key'] = 'dify-sandbox'
    request = urllib.request.Request(BASE + path, data=data, headers=headers)
    start = time.monotonic()
    try:
        with urllib.request.urlopen(request, timeout=16) as response:
            status, body = response.status, response.read(20000).decode()
    except urllib.error.HTTPError as error:
        status, body = error.code, error.read(20000).decode()
    except Exception as error:
        return {'status': None, 'transport_error': repr(error), 'seconds': time.monotonic()-start}
    try:
        body = json.loads(body)
    except json.JSONDecodeError:
        pass
    return {'status': status, 'body': body, 'seconds': time.monotonic()-start}

results = {'captured_utc': datetime.datetime.now(datetime.timezone.utc).isoformat(),
           'image': 'langgenius/dify-sandbox@sha256:750e1111426ef31a9217b81c98cccfb750f17b182af3221102e420afa9f0928e',
           'deployment': 'dedicated Docker internal network; localhost port; no host mounts; resource limits',
           'health': call('/health'),
           'unauthenticated': call('/v1/sandbox/run', {'language':'python3','code':'print(1)','enable_network':False}),
           'cases': {}}
for name, code in CASES:
    result = call('/v1/sandbox/run', {'language': 'python3', 'code': code,
                                    'enable_network': name == 'external_network'}, True)
    results['cases'][name] = result
    print(name, json.dumps(result))
results['post_timeout_health'] = call('/health')
result_name = 'sandbox-followup-results.json' if os.environ.get('PLATFORM_SANDBOX_FOLLOWUP') == '1' else 'sandbox-results.json'
(ROOT / result_name).write_text(json.dumps(results, indent=2), encoding='utf-8')
print(f'Evidence saved to {result_name}; observations do not declare a production PASS.')
