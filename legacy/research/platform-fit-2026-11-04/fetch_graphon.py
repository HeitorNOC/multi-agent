"""Capture the exact engine revision selected by Dify; never executes downloads."""
import datetime
import hashlib
import io
import json
from pathlib import Path
import urllib.request
import zipfile

SHA = '4fa22141774dff80e90e4dfa98ea3e6fbf0421bb'
ROOT = Path(__file__).resolve().parent
DEST = ROOT / 'sources' / 'graphon'
URL = f'https://codeload.github.com/langgenius/graphon/zip/{SHA}'
request = urllib.request.Request(URL, headers={'User-Agent': 'enterprise-platform-qualification'})
with urllib.request.urlopen(request, timeout=45) as response:
    body = response.read(30_000_001)
if len(body) > 30_000_000:
    raise RuntimeError('Archive size limit exceeded')
DEST.mkdir(parents=True, exist_ok=True)
with zipfile.ZipFile(io.BytesIO(body)) as archive:
    for entry in archive.infolist():
        parts = Path(entry.filename).parts[1:]
        if not parts or entry.is_dir():
            continue
        target = DEST.joinpath(*parts).resolve()
        if not target.is_relative_to(DEST.resolve()):
            raise RuntimeError('Unsafe archive path')
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(archive.read(entry))
manifest = {'repo': 'langgenius/graphon', 'sha': SHA, 'url': URL,
            'captured_utc': datetime.datetime.now(datetime.timezone.utc).isoformat(),
            'archive_sha256': hashlib.sha256(body).hexdigest(), 'archive_bytes': len(body),
            'files': [{'path': str(p.relative_to(DEST)).replace('\\', '/'),
                       'sha256': hashlib.sha256(p.read_bytes()).hexdigest()}
                      for p in sorted(DEST.rglob('*')) if p.is_file()]}
(ROOT / 'graphon-manifest.json').write_text(json.dumps(manifest, indent=2), encoding='utf-8')
print(json.dumps({k: v for k, v in manifest.items() if k != 'files'}))
print('files', len(manifest['files']))
