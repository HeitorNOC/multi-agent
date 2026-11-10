"""Capture hashes and independently verify all exported authority signatures."""
import hashlib
import importlib.metadata as metadata
import json
from pathlib import Path
import re
import shutil
import subprocess
import sys
import xml.etree.ElementTree as ET
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PublicKey

HERE=Path(__file__).resolve().parent
ROOT=HERE.parents[1]
result=json.loads((HERE/'evidence/results.json').read_text(encoding='utf-8'))
assert result['result']=='PASS_BOUNDED_SIGNED_INTEGRATION'
assert len(result['checkpoints'])==10
assert result['model_calls']==0 and result['production_approved'] is False
assert result['provider']['unique_receipts']==2 and all(n==1 for n in result['provider']['send_counts'].values())
assert sum(r['accepted'] for r in result['retained_admissions'])==1
assert all(r['accepted'] or r['status']==429 for r in result['retained_admissions'])
assert result['final_retained_state']['pending_count']==1
assert result['final_retained_state']['budgets']['business']=={'cap':12,'reserved':12}
public=json.loads((HERE/'evidence/authority-public.json').read_text(encoding='utf-8'))
assert public['installation']==result['installation']
source=HERE/'.state'/result['installation']/'signed-proofs.jsonl'
destination=HERE/'evidence/signed-proofs.jsonl'
shutil.copy2(source,destination)
key=Ed25519PublicKey.from_public_bytes(bytes.fromhex(public['public']))
count=0
for line in destination.read_text(encoding='utf-8').splitlines():
    row=json.loads(line);proof=row['proof'];payload=proof['payload'];raw=proof['payload_json']
    assert json.loads(raw)==payload
    key.verify(bytes.fromhex(proof['signature']),raw.encode())
    assert payload['installation']==public['installation']
    assert payload['nonce']==row['request']['nonce']
    assert abs(payload['issued']-row['request']['issued'])<=30
    assert json.loads(proof['operations_json'])==payload['operations']
    assert hashlib.sha256(proof['operations_json'].encode()).hexdigest()==payload['head']
    assert payload['seq']==len(payload['operations'])
    assert [r['seq'] for r in payload['operations']]==list(range(1,payload['seq']+1))
    count+=1
checks={}
for name,expected in [('signed-final.xml',1),('budget-final.xml',3),('baseline-regression.xml',1)]:
    suites=ET.parse(HERE/name).getroot().findall('testsuite')
    assert sum(int(s.attrib['tests']) for s in suites)==expected
    assert all(int(s.attrib['errors'])==int(s.attrib['failures'])==0 for s in suites)
    checks[name]=expected
assert 'tests 16' in (HERE/'node-final.log').read_text(encoding='utf-8')
assert not (HERE/'typecheck-final.log').read_text(encoding='utf-8').strip()
for document in [HERE/'RESULTS.md',HERE/'COMMANDS.md']:
    for link in re.findall(r'\]\(([^)]+)\)',document.read_text(encoding='utf-8')):
        if not link.startswith(('http://','https://')):assert (document.parent/link).exists(),link
environment={'python':sys.version,'node':subprocess.check_output(['node','--version'],text=True).strip(),
             'versions':result['versions'],'source_sha':result['source_sha'],'postgres_image':result['postgres_image'],
             'cryptography':metadata.version('cryptography')}
(HERE/'environment.json').write_text(json.dumps(environment,indent=2),encoding='utf-8')
verification={'junit':checks,'signed_checkpoints':10,'node_tests':16,'typescript_strict':'PASS',
              'authority_proofs_verified':count,'nonce_and_recorded_request_time_checked':True,
              'final_pending_intent_preserved':True,'model_calls':0,'production_approved':False,'local_links':'OK'}
(HERE/'verification.json').write_text(json.dumps(verification,indent=2),encoding='utf-8')
shared=[ROOT/'validation/langgraph-business-flow'/p for p in ['business.ts','worker.py','test_flow.py']]
shared += [ROOT/'validation/concurrent-reconciliation'/p for p in ['freshness_authority.py','authority_client.py','test_authority.py']]
shared += [ROOT/'validation/temporal-editorial/editorial.ts',ROOT/'validation/integrated-pilot/provider.py']
files=list(HERE.glob('*'))+list((HERE/'evidence').glob('*'))+shared
hashes={str(p.relative_to(ROOT)).replace('\\','/'):hashlib.sha256(p.read_bytes()).hexdigest()
        for p in files if p.is_file() and p.name!='manifest.json'}
(HERE/'manifest.json').write_text(json.dumps({'files':hashes,'environment':environment},indent=2),encoding='utf-8')
print(json.dumps(verification))
