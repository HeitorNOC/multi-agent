"""Check artifact consistency and unchanged captured Graphon source."""
import hashlib
import json
from pathlib import Path
import re
import xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parents[2]
RESEARCH = ROOT / 'research/platform-fit-2026-11-04'
VALIDATION = Path(__file__).resolve().parent
captured = json.loads((RESEARCH / 'graphon-manifest.json').read_text(encoding='utf-8'))
for file in captured['files']:
    path = RESEARCH / 'sources/graphon' / file['path']
    assert hashlib.sha256(path.read_bytes()).hexdigest() == file['sha256'], file['path']
for filename, expected in [('graphon-upstream.xml', 45), ('dify-queue.xml', 4)]:
    suites = ET.parse(VALIDATION / filename).getroot().findall('testsuite')
    assert sum(int(s.attrib['tests']) for s in suites) == expected
    assert all(int(s.attrib['failures']) == int(s.attrib['errors']) == 0 for s in suites)
for folder in [RESEARCH, VALIDATION]:
    for document in folder.glob('*.md'):
        for target in re.findall(r'\]\(([^)]+)\)', document.read_text(encoding='utf-8')):
            if not target.startswith(('https://', 'http://')):
                assert (document.parent / target).exists(), (str(document), target)
observed = json.loads((VALIDATION / 'sandbox-results.json').read_text(encoding='utf-8'))
assert observed['unauthenticated']['status'] == 401
assert observed['health']['status'] == observed['post_timeout_health']['status'] == 200
followup = json.loads((VALIDATION / 'sandbox-followup-results.json').read_text(encoding='utf-8'))
for name in ['sleep_timeout', 'loop_timeout']:
    assert followup['cases'][name]['body']['data']['error'], name
    assert followup['cases'][name]['seconds'] < 1, name
result = {'captured_source_files_unchanged': len(captured['files']),
          'graphon_tests': 45, 'dify_queue_tests': 4, 'local_links': 'OK',
          'sandbox_timeout': 'NOT_VALIDATED_SYSCALL_ERROR', 'production': 'NOT_APPROVED'}
(VALIDATION / 'verification.json').write_text(json.dumps(result, indent=2), encoding='utf-8')
print(json.dumps(result))
