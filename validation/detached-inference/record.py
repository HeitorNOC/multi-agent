"""Verify this block's signatures, provider execution counts and observed usage."""
import hashlib,importlib.metadata,json,re,shutil,sqlite3,subprocess,sys
from pathlib import Path
import xml.etree.ElementTree as ET
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PublicKey

HERE=Path(__file__).resolve().parent;ROOT=HERE.parents[1]

def exported(folder,state_root):
    result=json.loads((folder/'results.json').read_text(encoding='utf-8'))
    public=json.loads((folder/'authority-public.json').read_text(encoding='utf-8'))
    assert public['installation']==result['installation']
    state=state_root/result['installation']
    shutil.copy2(state/'signed-proofs.jsonl',folder/'signed-proofs.jsonl')
    key=Ed25519PublicKey.from_public_bytes(bytes.fromhex(public['public']));count=0;last=None;reserved=set()
    for line in (folder/'signed-proofs.jsonl').read_text(encoding='utf-8').splitlines():
        row=json.loads(line);proof=row['proof'];payload=proof['payload']
        key.verify(bytes.fromhex(proof['signature']),proof['payload_json'].encode())
        assert json.loads(proof['payload_json'])==payload
        assert payload['installation']==result['installation'] and payload['nonce']==row['request']['nonce']
        assert abs(payload['issued']-row['request']['issued'])<=30
        assert json.loads(proof['operations_json'])==payload['operations']
        assert hashlib.sha256(proof['operations_json'].encode()).hexdigest()==payload['head']
        assert [r['seq'] for r in payload['operations']]==list(range(1,payload['seq']+1))
        if row['request']['action']=='reserve_call' and row['request']['scope']=='model':reserved.add(row['request']['id'])
        count+=1;last=payload
    assert count and last and not any(r['receipt_sha'] is None for r in last['operations'])
    usage=result.get('model_usage_records',[]);assert len(usage)==result['model_calls']
    assert all(r['exit_code']==r['unexpected_tool_events']==0 for r in usage)
    assert {r['reservation_id'] for r in usage}==reserved
    tokens={}
    for row in usage:
        for item in row['usage']:
            for name,value in item.items():tokens[name]=tokens.get(name,0)+value
    return result,state,{'proofs_verified':count,'pending_authority_operations':0,'budgets':last['budgets'],
                         'model_calls':len(usage),'model_reservations':len(reserved),'reservations_without_usage':0,'tokens_observed':tokens}

controlled,state,control_proofs=exported(HERE/'evidence',HERE/'.state')
assert controlled['result']=='PASS_BOUNDED_DETACHED_INFERENCE' and len(controlled['checkpoints'])==8
assert all(row[2]==1 for row in controlled['provider_executions'])
assert sum(row[1]=='admitted' for row in controlled['provider_executions'])==1
shutil.copy2(state/'inference-events.jsonl',HERE/'evidence/inference-events.jsonl')
native,native_state,native_proofs=exported(HERE/'native-evidence',ROOT/'validation/brain-recovery/.state')
assert native['result']=='PASS_BOUNDED_NATIVE_BRAIN_RECOVERY'
restored=list(native_state.glob('restored-brain-*/native.sqlite'));assert len(restored)==1
with sqlite3.connect(restored[0]) as db:
    receipts=[]
    for id,input_sha,status,result_json in db.execute('SELECT * FROM inference_receipts ORDER BY id'):
        value=json.loads(result_json)
        assert status=='complete' and value['id']==id and value['input_sha']==input_sha and value['semantic']['native']
        receipts.append({'id':id,'input_sha':input_sha,'state':status,'receipt_sha':hashlib.sha256(result_json.encode()).hexdigest()})
assert len(receipts)==3
with sqlite3.connect(restored[0].parent/'business.sqlite') as db:
    local=db.execute('SELECT id,input_json,state,receipt FROM inference_requests ORDER BY id').fetchall()
    assert len(local)==3
    for id,input_json,status,receipt in local:
        value=json.loads(receipt)
        assert status=='committed' and value['id']==id
        assert hashlib.sha256(input_json.encode()).hexdigest()==value['input_sha']
        assert any(r['id']==id and r['input_sha']==value['input_sha'] for r in receipts)
(HERE/'native-evidence/receipt-inventory.json').write_text(json.dumps(receipts,indent=2),encoding='utf-8')
for name in ('g0','g1'):shutil.copy2(native_state/name/'manifest.json',HERE/'native-evidence'/(name+'-manifest.json'))
regression,_,regression_proofs=exported(HERE/'governed-regression-evidence',ROOT/'validation/governed-recovery/.state')
assert regression['result']=='PASS_BOUNDED_GOVERNED_RECOVERY'
for name,n in [('final.xml',1),('native-2.xml',1),('governed-regression.xml',1),('units.xml',6)]:
    suites=ET.parse(HERE/name).getroot().findall('testsuite')
    assert sum(int(s.attrib['tests']) for s in suites)==n
    assert all(int(s.attrib['failures'])==int(s.attrib['errors'])==0 for s in suites)
assert 'tests 16' in (HERE/'node-tests.log').read_text(encoding='utf-8')
assert not (HERE/'typecheck.log').read_text(encoding='utf-8').strip()
verification={'controlled':control_proofs,'native':native_proofs,'governed_regression':regression_proofs,
    'unknown_inferences_in_controlled_fixture':1,'native_receipts_after_cold_restore':3,'node_tests':16,'python_authority_tests':6,
    'control_latency_seconds':controlled['control_latencies_seconds'],'production_approved':False,'monetary_cost_observed':False}
(HERE/'verification.json').write_text(json.dumps(verification,indent=2),encoding='utf-8')
environment={'python':sys.version,'node':subprocess.check_output(['node','--version'],text=True).strip(),
    'versions':{n:importlib.metadata.version(n) for n in ('lightrag-hku','langgraph','langgraph-checkpoint','langgraph-checkpoint-postgres','neo4j','asyncpg','psycopg','cryptography')},
    'vendor_sha':{n:subprocess.check_output(['git','-C',str(ROOT/'vendor'/n),'rev-parse','HEAD'],text=True).strip() for n in ('langgraph','lightrag')},
    'postgres_image':native['postgres_image'],'neo4j_image':'neo4j@sha256:fe8607113c4177fbd2466bf2c30f1ebab5b9530594e86487c58c98e113145192',
    'model':'gpt-6.1-terra','embedding_revision':'faf4aa4225822f3bc6376869cb1164e8e3feedd0'}
(HERE/'environment.json').write_text(json.dumps(environment,indent=2),encoding='utf-8')
files=list(HERE.glob('*'))
for directory in HERE.iterdir():
    if directory.is_dir() and not directory.name.startswith(('.','__')):files+=list(directory.glob('*'))
for directory,names in [('brain-recovery',['brain.ts','inference.ts','native.py','payload_guard.py','corpus.json','test_brain.py']),
                        ('langgraph-business-flow',['business.ts','worker.py','test_flow.py']),
                        ('langgraph-retained-flow',['retained.ts','test_signed_flow.py']),
                        ('concurrent-reconciliation',['codex_provider.py','freshness_authority.py','embedding_server.py'])]:
    files += [ROOT/'validation'/directory/name for name in names]
hashes={p.relative_to(ROOT).as_posix():hashlib.sha256(p.read_bytes()).hexdigest() for p in files if p.is_file() and p.name not in ('manifest.json','record.log')}
(HERE/'manifest.json').write_text(json.dumps({'files':hashes},indent=2),encoding='utf-8')
for document in (HERE/'RESULTS.md',HERE/'COMMANDS.md'):
    for target in re.findall(r'\]\(([^)]+)\)',document.read_text(encoding='utf-8')):
        if not target.startswith(('https://','http://')):assert (document.parent/target).exists(),target
print(json.dumps(verification))
