"""Offline capture verification only; not an application qualification test."""
import hashlib, json, pathlib
root=pathlib.Path(__file__).resolve().parent
manifest=json.loads((root/'manifest.json').read_text(encoding='utf-8'))
selection=json.loads((root/'selection.json').read_text(encoding='utf-8'))
errors=[]; notebooks=0
for item in manifest:
    p=root/'sources'/item['repo'].split('/')[1]/item['path']
    data=p.read_bytes()
    if hashlib.sha256(data).hexdigest()!=item['sha256']: errors.append(str(p))
    if p.suffix=='.ipynb':
        nb=json.loads(data)
        expected='\n\n'.join('CELL '+str(i)+' '+c['cell_type']+'\n'+''.join(c.get('source',[])) for i,c in enumerate(nb['cells']) if c['cell_type'] in ('markdown','code'))
        if p.with_suffix('.cells.txt').read_text(encoding='utf-8')!=expected: errors.append(str(p)+' cells')
        notebooks+=1
if {(x['repo'],x['path']) for x in manifest}!={(x['repo'],x['path']) for x in selection}: errors.append('selection mismatch')
result={'capture_integrity':'PASS' if not errors else 'FAIL','source_files':len(manifest),'notebooks':notebooks,'errors':errors,'upstream_tests_executed':False,'business_v1_requalified':False,'new_inference_calls':0}
(root/'verification.json').write_text(json.dumps(result,indent=2),encoding='utf-8')
print(json.dumps(result)); raise SystemExit(bool(errors))
