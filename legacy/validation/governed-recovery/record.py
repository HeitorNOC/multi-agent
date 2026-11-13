"""Verify final artifacts, retained votes and public signatures; preserve negatives."""
import hashlib
import json
from pathlib import Path
import re
import shutil
import sqlite3
import subprocess
import sys
import xml.etree.ElementTree as ET
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PublicKey

HERE=Path(__file__).resolve().parent;ROOT=HERE.parents[1]
result=json.loads((HERE/'evidence/results.json').read_text(encoding='utf-8'))
assert result['result']=='PASS_BOUNDED_GOVERNED_RECOVERY'
assert len(result['checkpoints'])==9 and result['model_calls']==0 and result['production_approved'] is False
assert result['final_retained_state']=={'budgets':{'business':{'cap':16,'reserved':9}},'pending_count':0,'current':True}
assert result['missing_receipt_lookup']=={'rejected':True,'sends':0}
assert result['provider']['unique_receipts']==2 and all(n==1 for n in result['provider']['send_counts'].values())
assert result['closure']['approvers']==result['effect_reconciliation']['approvers']==['board','reviewer2']
assert result['checkpoints'][-1]['restored_checkpoints']>0 and result['second_restore_status']['current']
failed=json.loads((HERE/'evidence/stale-bundle-failed.json').read_text(encoding='utf-8'))
assert failed['result']=='FAIL'
failed_state=HERE/'.state'/failed['installation']
def scalar(path,sql):
    with sqlite3.connect('file:'+str(path)+'?mode=ro',uri=True) as db:return db.execute(sql).fetchone()[0]
diagnostic={'authority_operations':scalar(failed_state/'retained-outside-backup.sqlite','SELECT count(*) FROM operations'),
            'stale_bundle_receipts':scalar(failed_state/'g2-after-effect-reconciliation/business.sqlite','SELECT count(*) FROM retained_receipts'),
            'active_receipt_counts':[scalar(p,'SELECT count(*) FROM retained_receipts') for p in failed_state.glob('restore-*/business.sqlite')]}
assert diagnostic['authority_operations']>diagnostic['stale_bundle_receipts']
(HERE/'evidence/stale-bundle-diagnostic.json').write_text(json.dumps(diagnostic,indent=2),encoding='utf-8')
public=json.loads((HERE/'evidence/authority-public.json').read_text(encoding='utf-8'))
assert public['installation']==result['installation']
log=HERE/'evidence/signed-proofs.jsonl'
shutil.copy2(HERE/'.state'/result['installation']/'signed-proofs.jsonl',log)
key=Ed25519PublicKey.from_public_bytes(bytes.fromhex(public['public']));proof_count=0;latest=None
for line in log.read_text(encoding='utf-8').splitlines():
    row=json.loads(line);proof=row['proof'];payload=proof['payload']
    assert json.loads(proof['payload_json'])==payload
    key.verify(bytes.fromhex(proof['signature']),proof['payload_json'].encode())
    assert payload['installation']==public['installation'] and payload['nonce']==row['request']['nonce']
    assert abs(payload['issued']-row['request']['issued'])<=30
    assert json.loads(proof['operations_json'])==payload['operations']
    assert hashlib.sha256(proof['operations_json'].encode()).hexdigest()==payload['head']
    assert [r['seq'] for r in payload['operations']]==list(range(1,payload['seq']+1))
    proof_count+=1;latest=payload
assert latest and not any(r['receipt_sha'] is None for r in latest['operations'])
for response,outcome in [(result['closure'],'closed_unknown'),(result['effect_reconciliation'],'reconciled_effect')]:
    operation=next(r for r in latest['operations'] if r['id']==response['operation_id'])
    assert operation['outcome']==outcome
    votes=[v for v in latest['recovery_votes'] if v['operation_id']==operation['id']]
    assert len(votes)==2 and {v['actor'] for v in votes}=={'board','reviewer2'}
    assert all(v['actor']!=operation['context']['owner'] and v['evidence_sha']==response['evidence_sha'] and v['reason']==response['reason'] for v in votes)
for name,n in [('final.xml',1),('units-final.xml',5),('signed-regression.xml',1)]:
    suites=ET.parse(HERE/name).getroot().findall('testsuite')
    assert sum(int(s.attrib['tests']) for s in suites)==n
    assert all(int(s.attrib['errors'])==int(s.attrib['failures'])==0 for s in suites)
assert 'tests 16' in (HERE/'node-final.log').read_text(encoding='utf-8')
assert not (HERE/'typecheck-final.log').read_text(encoding='utf-8').strip()
for document in [HERE/'RESULTS.md',HERE/'COMMANDS.md']:
    for target in re.findall(r'\]\(([^)]+)\)',document.read_text(encoding='utf-8')):
        if not target.startswith(('http://','https://')):assert (document.parent/target).exists(),target
verification={'integration_tests':1,'checkpoints':9,'python_authority_tests':5,'node_tests':16,'signed_regression':'PASS',
              'authority_proofs_verified':proof_count,'retained_recovery_votes_verified':4,'negative_bundle_preserved':True,
              'pending_operations':0,'model_calls':0,'production_approved':False,'local_links':'OK'}
(HERE/'verification.json').write_text(json.dumps(verification,indent=2),encoding='utf-8')
environment={'python':sys.version,'node':subprocess.check_output(['node','--version'],text=True).strip(),
             'versions':result['versions'],'langgraph_sha':result['source_sha'],'postgres_image':result['postgres_image']}
(HERE/'environment.json').write_text(json.dumps(environment,indent=2),encoding='utf-8')
shared=[ROOT/'validation/langgraph-retained-flow'/p for p in ['retained.ts','test_signed_flow.py']]
shared += [ROOT/'validation/langgraph-business-flow'/p for p in ['business.ts','worker.py','test_flow.py']]
shared += [ROOT/'validation/concurrent-reconciliation/freshness_authority.py',ROOT/'validation/integrated-pilot/provider.py',ROOT/'validation/temporal-editorial/editorial.ts']
files=list(HERE.glob('*'))+list((HERE/'evidence').glob('*'))+shared
hashes={str(p.relative_to(ROOT)).replace('\\','/'):hashlib.sha256(p.read_bytes()).hexdigest() for p in files if p.is_file() and p.name!='manifest.json'}
(HERE/'manifest.json').write_text(json.dumps({'environment':environment,'files':hashes},indent=2),encoding='utf-8')
print(json.dumps(verification))
