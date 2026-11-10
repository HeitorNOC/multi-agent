"""Verify private handoffs and export only bounded fictional results/metadata."""
import hashlib,json,pathlib,sqlite3,sys,urllib.request
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PublicKey
HERE=pathlib.Path(__file__).resolve().parent;ROOT=HERE.parents[1]
sys.path.insert(0,str(ROOT/'demo-enterprise'))
from telemetry import digest
active=json.loads((ROOT/'demo-enterprise/.state/active.json').read_text());state=pathlib.Path(active['state'])
with urllib.request.urlopen(active['url']+'/api/state',timeout=20) as response:current=json.load(response)
assert current['runtime']['run_profile']=='observability-v1'
def part(prompt,start,end):return json.loads(prompt.split(start,1)[1].split(end,1)[0])
jobs=[]
with sqlite3.connect(state/'telemetry-outbox.sqlite') as db:
    for job in current['jobs']:
        with urllib.request.urlopen(active['url']+'/api/jobs/'+job['id']+'/trace',timeout=20) as response:trace=json.load(response)
        artifacts={r[0]:json.loads(r[1]) for r in db.execute('SELECT sha,body FROM artifacts WHERE job=?',(job['id'],))}
        assert all(digest(value)==sha for sha,value in artifacts.items())
        assert db.execute('SELECT count(*) FROM outbox WHERE job=? AND delivered=0',(job['id'],)).fetchone()[0]==0
        inputs={e['model_slot']:artifacts[e['input_artifact_id']]['prompt'] for e in trace['events'] if e['kind']=='inference_requested'}
        outputs={e['model_slot']:artifacts[e['output_artifact_id']] for e in trace['events'] if e['kind']=='inference_completed'}
        for event in trace['events']:
            assert all(sha in artifacts for sha in event['fact_ids'])
            for ref in event['evidence']:
                assert ref['retrieved_fragment_id'] in artifacts
                if ref['canonical_fragment_id']:assert ref['canonical_fragment_id'] in artifacts
        if not job['plan']:
            candidate=outputs.get('plan');jobs.append({'id':job['id'],'status':job['status'],'selected':[],'report':None,'trace':trace,'handoffs':[],
                'rejected_plan':candidate,'proposed_agent_count':sum(1+len(t['specialists']) for t in candidate['teams']) if candidate else None,'artifact_count':len(artifacts),'approval':job['approval'],'receipt':job['receipt']});continue
        handoffs=[]
        for team in job['plan']['teams']:
            supplied=part(inputs['agent:'+team['lead']],'. Retornos dos seus especialistas: ','. Retorne JSON:')
            assert {r['agent'] for r in supplied}==set(team['specialists'])
            for item in supplied:
                assert digest(item['output'])==digest(outputs['agent:'+item['agent']])
                handoffs.append({'from':item['agent'],'to':team['lead'],'artifact_sha':digest(item['output']),'exact_payload_received':True})
        supplied=part(inputs['synthesis'],'. Relatórios das diretorias selecionadas: ','. Produza decisão integrada')
        assert {r['lead'] for r in supplied}=={t['lead'] for t in job['plan']['teams']}
        for item in supplied:
            assert digest(item['output'])==digest(outputs['agent:'+item['lead']])
            handoffs.append({'from':item['lead'],'to':'chief_synthesis','artifact_sha':digest(item['output']),'exact_payload_received':True})
        verified=[]
        for event in trace['events']:
            if event['kind']!='canonical_evidence_verified':continue
            for row in artifacts[event['output_artifact_id']]:
                assert hashlib.sha256(row['canonical_text'].encode()).hexdigest()==row['sha256']
                verified.append({'agent':event['capability_id'],'source':row['source'],'version':row['version'],'sha256':row['sha256'],'projection_id':row['projection_id']})
        jobs.append({'id':job['id'],'status':job['status'],'selected':job['plan']['capabilities'],'report':job['review']['report'] if job['review'] else None,'trace':trace,'handoffs':handoffs,'verified_sources':verified,'artifact_count':len(artifacts),'approval':job['approval'],'receipt':job['receipt']})
with sqlite3.connect(state/'engines/retained-outside-backup.sqlite') as db:reserved=db.execute("SELECT count(*) FROM reservations WHERE scope='model'").fetchone()[0]
public=json.loads((state/'evidence/authority-public.json').read_text());key=Ed25519PublicKey.from_public_bytes(bytes.fromhex(public['public']));proofs=0
for line in (state/'engines/signed-proofs.jsonl').read_text().splitlines():
    row=json.loads(line);proof=row['proof'];key.verify(bytes.fromhex(proof['signature']),proof['payload_json'].encode());proofs+=1
environment=json.loads((state/'environment.json').read_text(encoding='utf-8'))
export={'url':active['url'],'installation':current['runtime']['installation'],'jobs':jobs,'usage':current['runtime']['usage'],'reserved':reserved,'cap':40,'historical_aurora_reserved':55,'aggregate_aurora_reserved':55+reserved,'verified_authority_signatures':proofs,'versions':environment['versions'],'production_approved':False,'memory_scope':'approved short fictional canonical sources plus native retrieval; no universal entailment verifier'}
target=HERE/'native-evidence';target.mkdir(exist_ok=True);(target/'verified.json').write_text(json.dumps(export,ensure_ascii=False,indent=2),encoding='utf-8')
print(json.dumps({'jobs':[(j['status'],len(j['selected']),len(j['handoffs'])) for j in jobs],'calls':current['runtime']['usage']['calls'],'reserved':reserved,'verified_authority_signatures':proofs}))
