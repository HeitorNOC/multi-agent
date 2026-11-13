"""Verify exported signatures and measured usage; export no private keys or dumps."""
import hashlib
import json
import importlib.metadata
from pathlib import Path
import shutil
import re
import subprocess
import sys
import xml.etree.ElementTree as ET

from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PublicKey

HERE=Path(__file__).resolve().parent
ROOT=HERE.parents[1]

def inspect(directory,state_root):
    result=json.loads((directory/'results.json').read_text(encoding='utf-8'))
    public=json.loads((directory/'authority-public.json').read_text(encoding='utf-8'))
    assert result['installation']==public['installation']
    state=state_root/result['installation']
    shutil.copy2(state/'signed-proofs.jsonl',directory/'signed-proofs.jsonl')
    key=Ed25519PublicKey.from_public_bytes(bytes.fromhex(public['public']))
    proofs=[];reservations=set()
    for line in (directory/'signed-proofs.jsonl').read_text(encoding='utf-8').splitlines():
        row=json.loads(line);proof=row['proof'];payload=proof['payload']
        key.verify(bytes.fromhex(proof['signature']),proof['payload_json'].encode())
        assert json.loads(proof['payload_json'])==payload
        assert payload['nonce']==row['request']['nonce'] and payload['installation']==result['installation']
        assert abs(payload['issued']-row['request']['issued'])<=30
        assert json.loads(proof['operations_json'])==payload['operations']
        assert hashlib.sha256(proof['operations_json'].encode()).hexdigest()==payload['head']
        assert [r['seq'] for r in payload['operations']]==list(range(1,payload['seq']+1))
        if row['request']['action']=='reserve_call' and row['request']['scope']=='model':reservations.add(row['request']['id'])
        proofs.append(payload)
    calls=result.get('model_usage_records',[])
    assert len(calls)==result['model_calls']
    recorded={r['reservation_id'] for r in calls}
    assert recorded<=reservations
    tokens={}
    for row in calls:
        for usage in row['usage']:
            for name,value in usage.items():tokens[name]=tokens.get(name,0)+value
    assert all(r['unexpected_tool_events']==0 for r in calls)
    summary={'result':result['result'],'installation':result['installation'],'proofs_verified':len(proofs),
             'checkpoints':len(result['checkpoints']),'model_calls_recorded':len(calls),'model_reservations':len(reservations),
             'reservations_without_usage_record':sorted(reservations-recorded),'tokens_observed':tokens,
             'pending_operations':sum(r['receipt_sha'] is None for r in proofs[-1]['operations']),
             'budgets':proofs[-1]['budgets'],'unexpected_tool_events':0}
    for name in ('g0','g1'):
        if (state/name/'manifest.json').exists():shutil.copy2(state/name/'manifest.json',directory/(name+'-manifest.json'))
    (directory/'verified.json').write_text(json.dumps(summary,indent=2),encoding='utf-8')
    return summary

attempts=[]
for directory in [HERE/'attempt-1-evidence',HERE/'attempt-2-evidence',HERE/'evidence']:
    attempts.append(inspect(directory,HERE/'.state'))
assert attempts[-1]['result']=='PASS_BOUNDED_NATIVE_BRAIN_RECOVERY'
assert attempts[-1]['pending_operations']==0
assert not attempts[-1]['reservations_without_usage_record']
for name,count in [('attempt-3.xml',1),('regression.xml',1)]:
    suites=ET.parse(HERE/name).getroot().findall('testsuite')
    assert sum(int(s.attrib['tests']) for s in suites)==count
    assert all(int(s.attrib['errors'])==int(s.attrib['failures'])==0 for s in suites)
assert 'tests 16' in (HERE/'node-tests.log').read_text(encoding='utf-8')
assert '6 passed' in (HERE/'unit-tests.log').read_text(encoding='utf-8')
assert not (HERE/'typecheck.log').read_text(encoding='utf-8').strip()
for document in [HERE/'RESULTS.md',HERE/'COMMANDS.md']:
    for target in re.findall(r'\]\(([^)]+)\)',document.read_text(encoding='utf-8')):
        if not target.startswith(('http://','https://')):assert (document.parent/target).exists(),target
verification={'attempts':attempts,'production_approved':False,'monetary_cost_observed':False}
(HERE/'verification.json').write_text(json.dumps(verification,indent=2),encoding='utf-8')
environment={'python':sys.version,'node':subprocess.check_output(['node','--version'],text=True).strip(),
    'codex':subprocess.check_output([shutil.which('codex'),'--version'],text=True,stderr=subprocess.DEVNULL).strip(),
    'versions':{name:importlib.metadata.version(name) for name in ('lightrag-hku','langgraph','langgraph-checkpoint','langgraph-checkpoint-postgres','neo4j','asyncpg','numpy','aiohttp','cryptography','psycopg','pytest')},
    'vendor_sha':{name:subprocess.check_output(['git','-C',str(ROOT/'vendor'/name),'rev-parse','HEAD'],text=True).strip() for name in ('lightrag','langgraph')},
    'postgres_image':'pgvector/pgvector@sha256:c0cd736fe8b8b5d408db56b780570bac404fe518e66e39de624aa46f9aabc60a',
    'neo4j_image':'neo4j@sha256:fe8607113c4177fbd2466bf2c30f1ebab5b9530594e86487c58c98e113145192',
    'embedding_revision':'faf4aa4225822f3bc6376869cb1164e8e3feedd0'}
(HERE/'environment.json').write_text(json.dumps(environment,indent=2),encoding='utf-8')
shared=[ROOT/'validation/langgraph-business-flow'/p for p in ('business.ts','worker.py','test_flow.py')]
shared += [ROOT/'validation/langgraph-retained-flow'/p for p in ('retained.ts','test_signed_flow.py')]
shared += [ROOT/'validation/concurrent-reconciliation'/p for p in ('freshness_authority.py','codex_provider.py','embedding_server.py')]
files=list(HERE.glob('*'))+shared
for folder in ('evidence','attempt-1-evidence','attempt-2-evidence','regression-evidence'):
    if (HERE/folder).exists():files+=list((HERE/folder).glob('*'))
hashes={p.relative_to(ROOT).as_posix():hashlib.sha256(p.read_bytes()).hexdigest() for p in files if p.is_file() and p.name not in ('manifest.json','record.log')}
(HERE/'manifest.json').write_text(json.dumps({'files':hashes},indent=2),encoding='utf-8')
print(json.dumps(verification))
