"""Verify the reported observations and capture local artifact/source hashes."""
import hashlib
import importlib.metadata as metadata
import json
from pathlib import Path
import re
import subprocess
import sys
import xml.etree.ElementTree as ET

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
result = json.loads((HERE/'evidence/results.json').read_text(encoding='utf-8'))
failed = json.loads((HERE/'evidence/two-api-failed.json').read_text(encoding='utf-8'))
assert result['result'] == 'PASS_BOUNDED_INTEGRATION'
assert failed['result'] == 'FAIL'
assert result['model_calls'] == 0 and result['production_approved'] is False
assert len(result['checkpoints']) == 9
assert result['provider']['unique_receipts'] == 3
assert all(n == 1 for n in result['provider']['send_counts'].values())
attempts = result['quota_attempts']
assert len(attempts) == 24 and sum(x['accepted'] for x in attempts) == 15
assert all(x['accepted'] or x['status'] == 429 for x in attempts)
suites = ET.parse(HERE/'final-run.xml').getroot().findall('testsuite')
assert sum(int(s.attrib['tests']) for s in suites) == 1
assert all(int(s.attrib['errors']) == int(s.attrib['failures']) == 0 for s in suites)
assert 'tests 12' in (HERE/'editorial-read-green.log').read_text(encoding='utf-8')
assert 'database is locked' in (HERE/'editorial-read-red.log').read_text(encoding='utf-8')
assert not (HERE/'typecheck-final.log').read_text(encoding='utf-8').strip()
diagnostic = json.loads((HERE/'evidence/quota-diagnostic-after.json').read_text(encoding='utf-8'))
assert len(diagnostic['requests']) == 48 and all(x['status']==429 for x in diagnostic['requests'])
assert all(not x for x in diagnostic['service_errors'])
for document in [HERE/'RESULTS.md',HERE/'COMMANDS.md']:
    for target in re.findall(r'\]\(([^)]+)\)',document.read_text(encoding='utf-8')):
        if not target.startswith(('http://','https://')):
            assert (document.parent/target).exists(), (str(document),target)
environment = {'python':sys.version,'node':subprocess.check_output(['node','--version'],text=True).strip(),
               'observed_distributions':sorted([{'name':d.metadata['Name'],'version':d.version} for d in metadata.distributions()],key=lambda x:x['name'].lower()),
               'note':'Observed pre-existing environment; not a newly resolved lockfile'}
(HERE/'environment.json').write_text(json.dumps(environment,indent=2),encoding='utf-8')
shared = [ROOT/'validation/temporal-editorial/editorial.ts',ROOT/'validation/temporal-editorial/editorial.test.ts',ROOT/'validation/integrated-pilot/provider.py']
files = list(HERE.glob('*')) + list((HERE/'evidence').glob('*')) + shared
hashes = {str(p.relative_to(ROOT)).replace('\\','/'):hashlib.sha256(p.read_bytes()).hexdigest()
          for p in files if p.is_file() and p.name not in ['manifest.json','verification.json']}
manifest = {'scope':'bounded integration, no production approval', 'langgraph_sha':result['source_sha'],
            'versions':result['versions'],'postgres_image':result['postgres_image'],'files':hashes}
(HERE/'manifest.json').write_text(json.dumps(manifest,indent=2),encoding='utf-8')
verification = {'integration_tests':1,'checkpoints':9,'node_tests':12,'typescript_strict':'PASS',
                'model_calls':0,'original_two_api_failure_preserved':True,'production_approved':False,
                'local_links':'OK','captured_files':len(hashes)}
(HERE/'verification.json').write_text(json.dumps(verification,indent=2),encoding='utf-8')
print(json.dumps(verification))
