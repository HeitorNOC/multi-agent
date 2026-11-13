"""Package explicit deliverables only; never include private .state or virtualenv."""
import csv,hashlib,json,subprocess,zipfile
from pathlib import Path

HERE=Path(__file__).resolve().parent
ROOT=HERE.parents[1]
def digest(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def files():
    return sorted([p for p in HERE.iterdir() if p.is_file() and p.name not in {'manifest.json','package-result.json'}]+[p for name in ('corpus','evidence') for p in (HERE/name).rglob('*') if p.is_file()])
def main():
    result=json.loads((HERE/'evidence/integration.json').read_text(encoding='utf-8'))
    assert result['result']=='PASS' and len(result['scenarios'])==13
    sources={}
    for name in ['langgraph','lightrag','paperclip','graphiti-audit','agentscope-audit','openagents-audit']:
        repo=ROOT/'vendor'/name
        sha=subprocess.check_output(['git','-C',str(repo),'rev-parse','HEAD'],text=True).strip()
        dirty=subprocess.check_output(['git','-C',str(repo),'status','--porcelain'],text=True).strip()
        sources[name]={'sha':sha,'working_tree_clean':not dirty}
    manifest={'date':'2026-11-03','result':'PASS','pytest_tests':1,'acceptance_checkpoints':13,'pytest_seconds':277.38,'production_approved':False,'images':result['images'],'source_repositories':sources,'files':{p.relative_to(HERE).as_posix():{'bytes':p.stat().st_size,'sha256':digest(p)} for p in files()},'excluded':['.state (private backups/keys)','.venv','__pycache__','vendor','.pytest_cache']}
    mp=HERE/'manifest.json';mp.write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    out=ROOT/'piloto_integrado_2026-11-03.zip'
    with zipfile.ZipFile(out,'w',zipfile.ZIP_DEFLATED) as z:
        for p in files()+[mp]:z.write(p,'integrated-pilot/'+p.relative_to(HERE).as_posix())
    with zipfile.ZipFile(out) as z:
        assert z.testzip() is None
        for name,meta in manifest['files'].items():assert hashlib.sha256(z.read('integrated-pilot/'+name)).hexdigest()==meta['sha256']
    summary={'archive':out.name,'bytes':out.stat().st_size,'sha256':digest(out),'files':len(manifest['files'])+1,'crc_and_entry_hashes_verified':True}
    (HERE/'package-result.json').write_text(json.dumps(summary,indent=2)+'\n',encoding='utf-8')
    print(json.dumps(summary,indent=2))

if __name__=='__main__':main()
