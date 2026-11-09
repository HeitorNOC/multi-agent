"""Safe export of the enterprise scenario, role execution and aggregate attempt usage."""
import hashlib,json,pathlib,sqlite3,urllib.request
HERE=pathlib.Path(__file__).resolve().parent;ROOT=HERE.parent
a=json.loads((HERE/'.state/active.json').read_text());s=pathlib.Path(a['state'])
with urllib.request.urlopen(a['url']+'/api/state',timeout=20) as res:state=json.load(res)
environment=json.loads((s/'environment.json').read_text(encoding='utf-8'))
calls=[json.loads(x) for x in (s/'engines/model/model-calls.jsonl').read_text().splitlines() if x.strip()]
embedding=[json.loads(x) for x in (s/'engines/embedding-calls.jsonl').read_text().splitlines() if x.strip()]
prior=json.loads((HERE/'evidence/first-attempt.json').read_text())
with sqlite3.connect(s/'model-slots.sqlite') as db:
    slots=[{'job':r[0],'slot':r[1],'status':r[2]} for r in db.execute('SELECT job,slot,status FROM slots')]
    candidates={r[0]:json.loads(json.loads(r[1])['text']) for r in db.execute('SELECT job,result FROM slots WHERE slot=? AND status=?',('synthesis','completed'))}
with sqlite3.connect(s/'journey.sqlite') as db:effects=db.execute('SELECT count(*) FROM effects').fetchone()[0]
with sqlite3.connect(s/'engines/retained-outside-backup.sqlite') as db:reserved=db.execute("SELECT count(*) FROM reservations WHERE scope='model'").fetchone()[0]
export={'url':a['url'],'environment':environment,'jobs':state['jobs'],'usage':state['runtime']['usage'],'slots':slots,'effect_count':effects,'model_calls':[{k:r[k] for k in ['call','model','seconds','exit_code','usage','unexpected_tool_events']} for r in calls],'attempts':{'prior':prior,'current_reserved':reserved,'aggregate_reserved':prior['reserved_calls']+reserved,'aggregate_cap':64},'embedding':{'batches':len(embedding),'segments':sum(r.get('embedded_segments',0) for r in embedding),'max_embedded_tokens':max(r.get('max_embedded_wordpiece_tokens',0) for r in embedding),'truncated_inputs':sum(r['truncated_inputs'] for r in embedding),'pooled_batches':sum(r.get('pool_long_inputs',False) for r in embedding)},'production_approved':False,'business_v1_requalified':False}
(HERE/'evidence/session.json').write_text(json.dumps(export,ensure_ascii=False,indent=2),encoding='utf-8')
checks=[]
for job in state['jobs']:
    selected=set(job['plan']['capabilities']) if job['plan'] else set()
    finished={e['detail']['capability'] for e in job['events'] if e['node'] in ['specialist_completed','director_completed']}
    inferred={r['slot'][6:] for r in slots if r['job']==job['id'] and r['slot'].startswith('agent:')}
    checks.append({'job':job['id'],'selected':sorted(selected),'finished':sorted(finished),'inferred':sorted(inferred),'selection_matches_execution':selected==finished==inferred,'review_accepted':bool(job['review']),'candidate':candidates.get(job['id'])})
(HERE/'evidence/decisions.json').write_text(json.dumps(checks,ensure_ascii=False,indent=2),encoding='utf-8')
files=[p for p in HERE.iterdir() if p.is_file() and p.suffix in ['.py','.ts','.tsx','.json','.css','.cjs','.html','.ps1','.md']]
files += [ROOT/x for x in ['demo/server.ts','validation/brain-recovery/native.py','validation/brain-recovery/test_brain.py','validation/concurrent-reconciliation/embedding_server.py','validation/concurrent-reconciliation/embedding_pooling.py']]
manifest={p.relative_to(ROOT).as_posix():hashlib.sha256(p.read_bytes()).hexdigest() for p in files}
(HERE/'evidence/source-manifest.json').write_text(json.dumps(manifest,indent=2),encoding='utf-8')
print(json.dumps({'jobs':[(j['id'],j['status'],len(j['plan']['capabilities']) if j['plan'] else 0) for j in state['jobs']],'current_calls':len(calls),'aggregate_reserved':prior['reserved_calls']+reserved,'truncated_inputs':export['embedding']['truncated_inputs']}))
