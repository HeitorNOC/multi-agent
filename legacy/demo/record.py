"""Export safe local evidence, excluding session tokens, DSNs and model prompts."""
import hashlib,json,pathlib,sqlite3,urllib.request
HERE=pathlib.Path(__file__).resolve().parent
active=json.loads((HERE/'.state/active.json').read_text())
with urllib.request.urlopen(active['url']+'/api/state',timeout=15) as response:state=json.load(response)
private=pathlib.Path(active['state']);environment=json.loads((private/'environment.json').read_text())
calls=[json.loads(line) for line in (private/'engines/model/model-calls.jsonl').read_text().splitlines() if line.strip()]
with sqlite3.connect(private/'journey.sqlite') as db:effects=db.execute('SELECT job,hash,receipt FROM effects').fetchall()
export={'url':active['url'],'environment':environment,'usage':state['runtime']['usage'],'jobs':state['jobs'],'model_calls':[{k:r[k] for k in ['call','model','seconds','exit_code','usage','unexpected_tool_events']} for r in calls],'effect_count':len(effects),'production_approved':False,'business_v1_requalified':False}
(HERE/'evidence/session.json').write_text(json.dumps(export,ensure_ascii=False,indent=2),encoding='utf-8')
manifest={p.relative_to(HERE).as_posix():hashlib.sha256(p.read_bytes()).hexdigest() for p in HERE.iterdir() if p.is_file() and p.suffix in ['.py','.ts','.tsx','.json','.cjs','.css','.html','.ps1','.md']}
(HERE/'evidence/source-manifest.json').write_text(json.dumps(manifest,indent=2),encoding='utf-8')
print(json.dumps({'calls':len(calls),'effects':len(effects),'jobs':[(j['id'],j['status']) for j in state['jobs']]}))
