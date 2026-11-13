"""Decision evidence verification. Red criteria remain red in the exported summary."""
import hashlib,importlib.metadata,json,pathlib,re,shutil,subprocess,sys
import xml.etree.ElementTree as ET
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PublicKey

HERE=pathlib.Path(__file__).resolve().parent;ROOT=HERE.parents[1]
def proofs(folder,state_root):
    result=json.loads((folder/'results.json').read_text(encoding='utf-8'))
    public=json.loads((folder/'authority-public.json').read_text(encoding='utf-8'))
    assert result['installation']==public['installation']
    shutil.copy2(state_root/result['installation']/'signed-proofs.jsonl',folder/'signed-proofs.jsonl')
    key=Ed25519PublicKey.from_public_bytes(bytes.fromhex(public['public']));count=0;last=None;reservations=set()
    for line in (folder/'signed-proofs.jsonl').read_text(encoding='utf-8').splitlines():
        row=json.loads(line);proof=row['proof'];p=proof['payload']
        key.verify(bytes.fromhex(proof['signature']),proof['payload_json'].encode())
        assert json.loads(proof['payload_json'])==p and json.loads(proof['operations_json'])==p['operations']
        assert p['nonce']==row['request']['nonce'] and p['installation']==result['installation']
        assert abs(p['issued']-row['request']['issued'])<=30
        assert hashlib.sha256(proof['operations_json'].encode()).hexdigest()==p['head']
        assert [r['seq'] for r in p['operations']]==list(range(1,p['seq']+1))
        if row['request']['action']=='reserve_call' and row['request']['scope']=='model':reservations.add(row['request']['id'])
        count+=1;last=p
    usage=result.get('model_usage_records',[]);assert len(usage)==result['model_calls']
    known={r['reservation_id'] for r in usage};assert known<=reservations
    tokens={}
    for row in usage:
        assert row['exit_code']==0 and row['unexpected_tool_events']==0
        for item in row['usage']:
            for name,value in item.items():tokens[name]=tokens.get(name,0)+value
    return result,{'signatures_verified':count,'pending_operations':sum(r['receipt_sha'] is None for r in last['operations']),
        'model_calls_with_usage':len(usage),'model_reservations':len(reservations),'reservations_without_usage':len(reservations-known),'tokens':tokens}

def junit(name):
    suites=ET.parse(HERE/name).getroot().findall('testsuite')
    return {k:sum(int(s.attrib.get(k,0)) for s in suites) for k in ('tests','failures','errors','skipped')}

v1=[]
for folder in sorted((HERE/'v1-evidence').iterdir()):
    result,proof=proofs(folder,HERE/'.state');v1.append({'installation':result['installation'],'result':result['result'],'stage':result.get('stage'),'proofs':proof})
assert sum(row['result']=='FAIL_V1_OPERATIONAL_RECOVERY' for row in v1)==3
assert sum(row['result']=='PASS_AUTOMATIC_HEARTBEAT_BOUNDED' for row in v1)==1
assert sum(row['result']=='FAIL_UNKNOWN_GOVERNED_CLOSURE' for row in v1)==1
native,verified=proofs(HERE/'v23-evidence',HERE/'.state')
first,first_verified=proofs(HERE/'v23-first-evidence',HERE/'.state')
second,second_verified=proofs(HERE/'v23-second-evidence',HERE/'.state')
regression,reg_verified=proofs(HERE/'governed-evidence',ROOT/'validation/governed-recovery/.state')
assert regression['result']=='PASS_BOUNDED_GOVERNED_RECOVERY'
rates=json.loads((HERE/'api-price-snapshot.json').read_text())['per_million_tokens']
def estimate(tokens):
    return {'usd_with_reported_cache':((tokens.get('input_tokens',0)-tokens.get('cached_input_tokens',0))*rates['input']+tokens.get('cached_input_tokens',0)*rates['cached_input']+tokens.get('output_tokens',0)*rates['output'])/1e6,
            'usd_if_no_input_cache':(tokens.get('input_tokens',0)*rates['input']+tokens.get('output_tokens',0)*rates['output'])/1e6}
totals={k:verified['tokens'].get(k,0)+first_verified['tokens'].get(k,0)+second_verified['tokens'].get(k,0) for k in verified['tokens']}
categories={}
for row in native.get('model_usage_records',[]):
    prompt=json.loads((HERE/'.state'/native['installation']/'model'/('llm-'+str(row['call']).zfill(2)+'.prompt.json')).read_text(encoding='utf-8'))['user_prompt']
    category='A1' if prompt.startswith('You are one analyst') else 'A3' if prompt.startswith(('You are Chief of Staff','You are the specialist')) else 'knowledge'
    values=categories.setdefault(category,{'calls':0,'tokens':{}});values['calls']+=1
    for usage in row['usage']:
        for k,v in usage.items():values['tokens'][k]=values['tokens'].get(k,0)+v
for value in categories.values():value['api_standard_price_scenario']=estimate(value['tokens'])
verification={'V1':{'decision':'FAIL_CONTINUITY','cases':v1,'junit':junit('v1.xml'),'unknown_junit':junit('unknown.xml')},
    'V2_V3':{'execution_result':native['result'],'proofs':verified,'junit':junit('v23.xml')},
    'V2_V3_initial_failed_execution':{'result':first['result'],'proofs':first_verified,'junit':junit('v23-first.xml')},
    'V2_V3_second_failed_execution':{'result':second['result'],'proofs':second_verified,'junit':junit('v23-second.xml')},
    'V4':{'decision':'CONDITIONAL_LOCAL_CONTROLS_ONLY','junit':junit('v4.xml'),'commercial_api_tested':False,'physical_off_host_recovery_tested':False},
    'regression':{'junit':junit('governed.xml'),'proofs':reg_verified},'authority_units':junit('units.xml'),
    'grader_regressions':junit('grader.xml'),
    'total_model_usage':{'calls':native['model_calls']+first['model_calls']+second['model_calls'],'tokens':totals,'api_standard_price_scenario':estimate(totals),'billed_amount_observed':False},
    'final_run_categories':categories,
    'final_run_api_standard_price_scenario':estimate(verified['tokens']),
    'production_approved':False,'broad_product_development_recommended':False}
assert verification['V1']['junit']=={'tests':4,'failures':3,'errors':0,'skipped':0}
assert verification['V1']['unknown_junit']=={'tests':1,'failures':1,'errors':0,'skipped':0}
assert verification['V2_V3']['junit']=={'tests':1,'failures':1,'errors':0,'skipped':0}
assert native['failures']==['A3:answer_quality']
assert 'tests 16' in (HERE/'node-tests.log').read_text(encoding='utf-8')
assert not (HERE/'typecheck.log').read_text(encoding='utf-8').strip()
(HERE/'verification.json').write_text(json.dumps(verification,indent=2,ensure_ascii=False),encoding='utf-8')
env={'python':sys.version,'node':subprocess.check_output(['node','--version'],text=True).strip(),
    'versions':{n:importlib.metadata.version(n) for n in ('lightrag-hku','langgraph','langgraph-checkpoint-postgres','neo4j','asyncpg','psycopg')},
    'vendor_sha':{n:subprocess.check_output(['git','-C',str(ROOT/'vendor'/n),'rev-parse','HEAD'],text=True).strip() for n in ('lightrag','langgraph')},
    'resources':native.get('resources'),'postgres_image':native.get('postgres_image'),'embedding_revision':'faf4aa4225822f3bc6376869cb1164e8e3feedd0'}
(HERE/'environment.json').write_text(json.dumps(env,indent=2),encoding='utf-8')
for document in (HERE/'RESULTS.md',HERE/'COMMANDS.md',HERE/'SOURCES.md'):
    if document.exists():
        for target in re.findall(r'\]\(([^)]+)\)',document.read_text(encoding='utf-8')):
            if not target.startswith(('http://','https://')) and target!='manifest.json':assert (document.parent/target).exists(),target
files=list(HERE.glob('*'))
for directory in ['v23-evidence','v23-first-evidence','v23-second-evidence','governed-evidence']:
    files+=list((HERE/directory).glob('*'))
for directory in (HERE/'v1-evidence').iterdir():files+=list(directory.glob('*'))
for directory,names in [('brain-recovery',['native.py','payload_guard.py','test_brain.py','inference.ts']),('langgraph-business-flow',['business.ts','worker.py','test_flow.py']),('langgraph-retained-flow',['retained.ts','test_signed_flow.py']),('concurrent-reconciliation',['codex_provider.py','freshness_authority.py','embedding_server.py']),('decision-qualification',['sandbox_gateway.py'])]:
    files += [ROOT/'validation'/directory/name for name in names]
hashes={p.relative_to(ROOT).as_posix():hashlib.sha256(p.read_bytes()).hexdigest() for p in files if p.is_file() and p.name not in ('manifest.json','record.log')}
(HERE/'manifest.json').write_text(json.dumps({'files':hashes},indent=2),encoding='utf-8')
print(json.dumps(verification))
