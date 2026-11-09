"""Offline verification. Never exports private session configuration or model prompts."""
import hashlib,json,pathlib,re,xml.etree.ElementTree as ET
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PublicKey
HERE=pathlib.Path(__file__).resolve().parent;ROOT=HERE.parents[1]
# Preserve originals privately; redact ephemeral fixture credentials from diagnostics.
for name in ['initial.log','initial.xml']:
    public=HERE/name;private=HERE/'.state/diagnostics'/name
    private.parent.mkdir(parents=True,exist_ok=True)
    if not private.exists():private.write_bytes(public.read_bytes())
    text=private.read_text(encoding='utf-8',errors='replace')
    text=re.sub(r"(?i)((?:token|secret|password)\s*=\s*['\"])[a-f0-9]{32,}(['\"])",r'\1[redacted]\2',text)
    text=re.sub(r'(postgresql://[^:\s]+:)[^@\s]+@',r'\1[redacted]@',text)
    public.write_text(text,encoding='utf-8')
suites={}
for name in ['recovery-final.xml','regressions.xml','telemetry-final.xml']:
    root=ET.parse(HERE/name).getroot();nodes=[root] if root.tag=='testsuite' else list(root.iter('testsuite'))
    suites[name]={key:sum(int(n.attrib.get(key,0)) for n in nodes) for key in ['tests','failures','errors','skipped']}
    suites[name]['seconds']=sum(float(n.attrib.get('time',0)) for n in nodes)
    assert suites[name]['failures']==suites[name]['errors']==0
assert [suites[n]['tests'] for n in suites]==[10,7,5]
assert 'pass 30' in (HERE/'node-final.log').read_text(encoding='utf-8')
assert all(not (HERE/n).read_text().strip() for n in ['typecheck-final.log','ui-typecheck-final.log'])
verified=[]
for result in sorted((HERE/'evidence').glob('*/results.json')):
    data=json.loads(result.read_text(encoding='utf-8'));installation=data['installation']
    public=result.with_name('authority-public.json');stream=HERE/'.state'/installation/'signed-proofs.jsonl'
    count=0
    if public.exists() and stream.exists():
        key=Ed25519PublicKey.from_public_bytes(bytes.fromhex(json.loads(public.read_text())['public']))
        for line in stream.read_text().splitlines():
            row=json.loads(line);proof=row['proof'];payload=json.loads(proof['payload_json'])
            key.verify(bytes.fromhex(proof['signature']),proof['payload_json'].encode())
            assert payload==proof['payload'] and payload['installation']==installation
            assert json.loads(proof['operations_json'])==payload['operations']
            assert hashlib.sha256(proof['operations_json'].encode()).hexdigest()==payload['head']
            assert [r['seq'] for r in payload['operations']]==list(range(1,payload['seq']+1));count+=1
    verified.append({'installation':installation,'result':data.get('result'),'signature_count':count})
native=json.loads((HERE/'native-evidence/verified.json').read_text(encoding='utf-8'))
scenario=json.loads((HERE/'native-evidence/scenarios.json').read_text(encoding='utf-8'))
assert scenario['result']=='PASS' and len(scenario['scenarios'])==2
assert native['reserved']==native['usage']['calls']==33 and native['aggregate_aurora_reserved']==88
assert sorted(len(j['selected']) for j in native['jobs'])==[0,4,8]
assert all(not j['approval'] and j['receipt'] is None for j in native['jobs'])
assert sum(len(j['handoffs']) for j in native['jobs'])==12
report={'suites':suites,'node_tests':30,'strict':True,'recovery_attempts':verified,'native':{'result':'PASS_BOUNDED_TWO_SCENARIOS','calls':33,'reserved':33,'historical_aurora_reserved':55,'aggregate_aurora_reserved':88,'verified_authority_signatures':native['verified_authority_signatures'],'exact_handoffs':12},'production_approved':False,'new_qualification_does_not_rewrite_historical_failures':True}
(HERE/'verification.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
files=[p for p in HERE.iterdir() if p.is_file() and p.name not in ['manifest.json']]
files+=list((HERE/'native-evidence').glob('*.json'))
files+=[ROOT/p for p in ['README.md','validation/STATUS.md','docs/PENDENCIAS_PRODUCAO.md','docs/PLANO_OBSERVABILIDADE.md','demo-enterprise/README.md','demo/server.ts','demo/telemetry.ts','demo/telemetry.test.ts','demo/server.test.ts','demo/start.py','demo-enterprise/start.py','demo-enterprise/worker.py','demo-enterprise/telemetry.py','demo-enterprise/ui.tsx','demo-enterprise/ui.css','demo-enterprise/test_scenarios.py','demo-enterprise/dist/app.js','demo-enterprise/dist/app.css','validation/langgraph-business-flow/business.ts','validation/langgraph-retained-flow/retained.ts','validation/langgraph-retained-flow/inference_recovery.ts','validation/brain-recovery/inference.ts','validation/brain-recovery/native.py','validation/detached-inference/fixture_provider.py','validation/concurrent-reconciliation/freshness_authority.py']]
manifest={p.relative_to(ROOT).as_posix():hashlib.sha256(p.read_bytes()).hexdigest() for p in files}
(HERE/'manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2),encoding='utf-8')
print(json.dumps({'python_tests':sum(x['tests'] for x in suites.values()),'node_tests':30,'historical_recovery_attempts':len(verified),'verified_recovery_signatures':sum(x['signature_count'] for x in verified),'native_calls':33,'exact_handoffs':12,'hashed_files':len(manifest)}))
