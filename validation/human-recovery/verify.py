"""Offline verification of the human console; no secrets or model calls exported."""
import hashlib,json,pathlib,sqlite3,xml.etree.ElementTree as ET
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PublicKey
HERE=pathlib.Path(__file__).resolve().parent;ROOT=HERE.parents[1]
suites={}
for name,count in [('final.xml',16),('console-final.xml',2),('inspection-release.xml',2),('isolated-regressions.xml',2)]:
    root=ET.parse(HERE/name).getroot();nodes=[root] if root.tag=='testsuite' else list(root.iter('testsuite'))
    entry={key:sum(int(n.attrib.get(key,0)) for n in nodes) for key in ['tests','failures','errors','skipped']}
    entry['seconds']=sum(float(n.attrib.get('time',0)) for n in nodes)
    assert entry['tests']==count and entry['failures']==entry['errors']==0;suites[name]=entry
assert 'pass 33' in (HERE/'node-final.log').read_text(encoding='utf-8')
assert all(not (HERE/name).read_text().strip() for name in ['typecheck-ui-final.log','typecheck-protocol-final.log'])
records=[]
for result in sorted((HERE/'evidence').glob('*/results.json'))+list(HERE.glob('*regression-evidence/results.json'))+list((HERE/'regression-imported-current').glob('*/results.json')):
    data=json.loads(result.read_text(encoding='utf-8'));installation=data['installation'];public=result.with_name('authority-public.json');count=0;stream=None
    for parent in [HERE,ROOT/'validation/observability-recovery',ROOT/'validation/governed-recovery']:
        path=parent/'.state'/installation/'signed-proofs.jsonl'
        if path.exists():stream=path;break
    if public.exists() and stream:
        key=Ed25519PublicKey.from_public_bytes(bytes.fromhex(json.loads(public.read_text())['public']))
        for line in stream.read_text(encoding='utf-8').splitlines():
            row=json.loads(line);proof=row['proof'];payload=json.loads(proof['payload_json'])
            key.verify(bytes.fromhex(proof['signature']),proof['payload_json'].encode())
            assert payload==proof['payload'] and payload['installation']==installation and payload['nonce']==row['request']['nonce']
            assert hashlib.sha256(proof['operations_json'].encode()).hexdigest()==payload['head']
            assert json.loads(proof['operations_json'])==payload['operations']
            assert [item['seq'] for item in payload['operations']]==list(range(1,payload['seq']+1));count+=1
    assert data.get('model_calls',0)==0
    records.append({'artifact':result.relative_to(ROOT).as_posix(),'installation':installation,'result':data.get('result'),'signatures_verified':count})
active=json.loads((HERE/'.state/active.json').read_text(encoding='utf-8'));state=pathlib.Path(active['state']).parent
with sqlite3.connect('file:'+str(state/'business.sqlite').replace('\\','/')+'?mode=ro',uri=True) as db:
    cases=[{'id':r[0],'job':r[1],'state':r[2]} for r in db.execute('SELECT id,job,state FROM inference_requests ORDER BY id')]
with sqlite3.connect('file:'+str(state/'retained-outside-backup.sqlite').replace('\\','/')+'?mode=ro',uri=True) as db:
    votes=db.execute('SELECT count(*) FROM recovery_votes').fetchone()[0];pending=db.execute('SELECT count(*) FROM operations WHERE receipt_sha IS NULL').fetchone()[0]
with sqlite3.connect('file:'+str(state/'inference.sqlite').replace('\\','/')+'?mode=ro',uri=True) as db:provider=[{'id':r[0],'state':r[1],'runs':r[2]} for r in db.execute('SELECT id,state,runs FROM calls')]
assert len(cases)==len(provider)==2 and votes==0 and pending==1 and all(row['runs']==1 for row in provider)
report={'suites':suites,'reexecutions_not_independent_test_totals':True,'node_tests':33,'strict':True,'new_model_calls':0,'proof_records':records,
        'live':{'url':active['url'],'installation':active['installation'],'mode':'controlled recovery-only profile','cases':cases,'provider':provider,'votes':votes,'pending_retained_operations':pending},
        'historical_export_limitation':{'superseded':['validation/observability-recovery/detached-regression-evidence/results.json','validation/observability-recovery/detached-regression-evidence/authority-public.json','validation/observability-recovery/governed-regression-evidence/results.json','validation/observability-recovery/governed-regression-evidence/authority-public.json'],'original_public_keys_not_recovered':True,'historical_junit_and_logs_preserved':True},
        'ui_visual_review_completed':False,'direct_mvp_model_slots_migrated':False,'production_approved':False}
(HERE/'verification.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
files=[p for p in HERE.iterdir() if p.is_file() and p.name!='manifest.json']
files+=list(HERE.glob('*regression-evidence/*.json'))+list((HERE/'regression-imported-current').glob('*/*.json'))
paths=['README.md','validation/STATUS.md','docs/PENDENCIAS_PRODUCAO.md','docs/PLANO_OBSERVABILIDADE.md','demo/server.ts','demo/recovery.ts','demo/recovery_bridge.py','demo/telemetry.ts','demo-enterprise/RecoveryCenter.tsx','demo-enterprise/recovery-ui.tsx','demo-enterprise/recovery.css','demo-enterprise/recovery.html','demo-enterprise/ui.tsx','demo-enterprise/start.py','demo-enterprise/build.cjs','demo-enterprise/dist/app.js','demo-enterprise/dist/app.css','demo-enterprise/dist/recovery.js','demo-enterprise/dist/recovery.css','validation/langgraph-retained-flow/retained.ts','validation/langgraph-retained-flow/recovery_queue.ts','validation/langgraph-retained-flow/inference_recovery.ts']
files+=[ROOT/p for p in paths]
manifest={p.relative_to(ROOT).as_posix():hashlib.sha256(p.read_bytes()).hexdigest() for p in files}
assert not any('.state' in pathlib.Path(p).parts for p in manifest)
secrets=json.loads(pathlib.Path(active['reviewers_file']).read_text(encoding='utf-8'))['accounts']
for path in files:
    if path.suffix in ['.md','.json','.log','.xml']:
        text=path.read_text(encoding='utf-8',errors='replace');assert active['token'] not in text and all(account['credential'] not in text for account in secrets)
(HERE/'manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2),encoding='utf-8')
print(json.dumps({'node_tests':33,'main_python_tests':16,'model_calls':0,'verified_signatures':sum(r['signatures_verified'] for r in records),'live_url':active['url'],'live_cases':len(cases),'live_votes':votes,'hashed_files':len(manifest)}))

