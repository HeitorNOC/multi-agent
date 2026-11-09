"""Freeze evidence inventory and verify the incremental audit archive."""
import datetime
import hashlib
import json
import os
from pathlib import Path
import subprocess
import xml.etree.ElementTree as ET
import zipfile

HERE=Path(__file__).resolve().parent
ROOT=HERE.parents[1]


def output(args):return subprocess.check_output(args,text=True,encoding='utf-8',cwd=ROOT).strip()
def sha(path):return hashlib.sha256(path.read_bytes()).hexdigest()


def main():
    manifest={'captured_utc':datetime.datetime.now(datetime.timezone.utc).isoformat(),
              'scope':'production-readiness investigation and bounded local qualification, not production approval',
              'projects':{},'environments':{},'pytest':{},'probes':{},'files':{}}
    projects={'langgraph':'vendor/langgraph','lightrag':'vendor/lightrag','graphiti':'vendor/graphiti-audit',
              'paperclip':'vendor/paperclip','agentscope':'vendor/agentscope-audit','openagents':'vendor/openagents-audit'}
    for name,folder in projects.items():
        manifest['projects'][name]={'sha':output(['git','-C',folder,'rev-parse','HEAD']),
                                   'tracked_diff':output(['git','-C',folder,'diff','--stat']),
                                   'origin':output(['git','-C',folder,'remote','get-url','origin'])}
    manifest['graphiti_lock_sha256']=sha(ROOT/'vendor/graphiti-audit/uv.lock')
    envs=[('poc','poc/.venv/Scripts/python.exe',['langgraph','langgraph-checkpoint','langgraph-checkpoint-sqlite','lightrag-hku']),
          ('graphiti','validation/production-readiness/graphiti-venv/Scripts/python.exe',['graphiti-core','pytest','pytest-asyncio']),
          ('postgres-runtime','validation/production-readiness/postgres-runtime/Scripts/python.exe',['langgraph','langgraph-checkpoint','langgraph-checkpoint-postgres','psycopg','psycopg-pool','psycopg-binary'])]
    for name,py,packages in envs:
        code='import sys,json,importlib.metadata as m;print(json.dumps({"python":sys.version,"packages":{p:m.version(p) for p in '+repr(packages)+'}}))'
        manifest['environments'][name]=json.loads(output([str(ROOT/py),'-c',code]))
        freeze=subprocess.check_output([str(ROOT/'validation/.tools/Scripts/uv.exe'),'pip','freeze','--python',str(ROOT/py)],text=True,encoding='utf-8',cwd=ROOT,env={**os.environ,'UV_CACHE_DIR':str(ROOT/'validation/uv-cache')})
        (HERE/'evidence'/f'{name}-freeze.txt').write_text(freeze,encoding='utf-8')
    manifest['node']=output(['node','--version'])
    for name in ['lightrag-upstream','brain','graphiti-unit','costs']:
        suite=ET.parse(HERE/'evidence'/f'{name}.xml').find('.//testsuite')
        assert suite.attrib['failures']=='0' and suite.attrib['errors']=='0'
        manifest['pytest'][name]=suite.attrib
    for name in ['sandbox','postgres','identity','pg-saver']:
        data=json.loads((HERE/'evidence'/f'{name}.json').read_text())
        assert data['result']=='PASS'
        manifest['probes'][name]={'result':data['result'],'checks':len(data.get('checks',[])),
                                  'scope':data.get('scope',data.get('profile_scope'))}
    sandbox=json.loads((HERE/'evidence/sandbox.json').read_text())
    assert all(x['removed'] for x in sandbox['cleanup'])
    manifest['images']={'sandbox':sandbox['image'],'postgres':json.loads((HERE/'evidence/postgres.json').read_text())['image']}
    selected=[p for p in HERE.iterdir() if p.is_file() and p.name!='manifest.json']
    selected += [p for p in (HERE/'evidence').rglob('*') if p.is_file()]
    selected += [ROOT/name for name in ['poc/runtime.py','poc/DOSSIER.md','poc/COMMANDS.md','validation/manifest.json','validation/motor-comparison/REPORT.md','validation/motor-comparison/BOUNDARIES.md']]
    for p in selected:
        manifest['files'][p.relative_to(ROOT).as_posix()]={'bytes':p.stat().st_size,'sha256':sha(p)}
    (HERE/'manifest.json').write_text(json.dumps(manifest,indent=2),encoding='utf-8')
    selected.append(HERE/'manifest.json')
    archive=ROOT/'investigacao_producao_2026-11-03.zip'
    with zipfile.ZipFile(archive,'w',zipfile.ZIP_DEFLATED) as z:
        for p in sorted(selected):z.write(p,p.relative_to(ROOT).as_posix())
    with zipfile.ZipFile(archive) as z:
        assert z.testzip() is None
        for name,data in manifest['files'].items():assert hashlib.sha256(z.read(name)).hexdigest()==data['sha256']
    print(json.dumps({'archive':str(archive),'files':len(selected),'bytes':archive.stat().st_size,'sha256':sha(archive),'pytest':{k:v['tests'] for k,v in manifest['pytest'].items()},'probes':manifest['probes']},indent=2))


if __name__=='__main__':main()
