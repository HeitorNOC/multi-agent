"""Build an explicit allowlist handoff; no private sessions or dependencies."""
import hashlib,json,pathlib,shutil,zipfile
HERE=pathlib.Path(__file__).resolve().parent;ROOT=HERE.parents[1]
evidence=[
 'demo/RESULTS.md','demo/COMMANDS.md','demo/evidence/journey.json','demo/evidence/user-approval.json',
 'demo-enterprise/RESULTS.md','demo-enterprise/COMMANDS.md','demo-enterprise/evidence/scenarios.json',
 'demo-enterprise/evidence/decisions.json','demo-enterprise/evidence/first-attempt.json','demo-enterprise/scenarios-verified.log',
 'demo-enterprise/unit-tests.log','demo-enterprise/embedding-tests.log','demo-enterprise/shared-api-regression.log',
 'validation/investment-gate/RESULTS.md','validation/investment-gate/v1.xml','validation/investment-gate/unknown.xml',
 'validation/investment-gate/v23.xml','validation/brain-recovery/RESULTS.md',
 'validation/detached-inference/RESULTS.md','validation/detached-inference/environment.json',
 'validation/paperclip-recheck/REPORT.md','docs/ARQUITETURA_BASE.md','docs/PENDENCIAS_PRODUCAO.md']
sources=['demo/server.ts','demo/policy.ts','demo/worker.py','demo/start.py','demo/build.cjs',
 'demo-enterprise/worker.py','demo-enterprise/start.py','demo-enterprise/policy.ts',
 'demo-enterprise/catalog.json','demo-enterprise/corpus.json',
 'validation/brain-recovery/native.py','validation/concurrent-reconciliation/embedding_pooling.py']
for group,paths in [('evidence',evidence),('sources',sources)]:
    for relative in paths:
        assert '.state' not in pathlib.Path(relative).parts
        target=HERE/group/relative;target.parent.mkdir(parents=True,exist_ok=True);shutil.copyfile(ROOT/relative,target)
shutil.copyfile(HERE/'RELATORIO_TECNICO.md',HERE/'RELATORIO_TECNICO.txt')
files=sorted(p for p in HERE.rglob('*') if p.is_file() and p.name not in ['MANIFEST_SHA256.json'] and p.suffix!='.zip')
manifest={p.relative_to(HERE).as_posix():hashlib.sha256(p.read_bytes()).hexdigest() for p in files}
(HERE/'MANIFEST_SHA256.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2),encoding='utf-8')
archive=HERE.parent/'estado-tecnico-multiagente-2026-11-05.zip'
with zipfile.ZipFile(archive,'w',zipfile.ZIP_DEFLATED) as output:
    for p in files+[HERE/'MANIFEST_SHA256.json']:output.write(p,p.relative_to(HERE).as_posix())
with zipfile.ZipFile(archive) as check:assert check.testzip() is None
assert all(hashlib.sha256((HERE/p).read_bytes()).hexdigest()==d for p,d in manifest.items())
print(json.dumps({'report_words':len((HERE/'RELATORIO_TECNICO.md').read_text(encoding='utf-8').split()),'files':len(files)+1,'zip_bytes':archive.stat().st_size,'zip':str(archive)},ensure_ascii=False))
