from pathlib import Path
import json,subprocess,datetime,hashlib,xml.etree.ElementTree as ET
r=Path('validation');root=Path.cwd();projects={'agentscope':'agentscope-audit','openagents':'openagents-audit','opencompany':'opencompany-zeenie','eigent':'eigent-audit'}
manifest={'date':'2026-11-03','captured_utc':datetime.datetime.now(datetime.timezone.utc).isoformat(),'scope':'Component reuse probes and selected upstream tests. No production, paid LLM or full platform certification.','projects':{}}
for project,folder in projects.items():
 repo=root/'vendor'/folder
 def git(*args):return subprocess.check_output(['git','-C',str(repo),*args],text=True).strip()
 info={'sha':git('rev-parse','HEAD'),'tracked_diff':git('diff','--stat'),'source':git('remote','get-url','origin')}
 python=root/r/project/'.venv/Scripts/python.exe'
 version=subprocess.check_output([str(python),'--version'],text=True).strip();info['python']=version
 frozen=subprocess.check_output([str(python),'-m','pip','freeze'],text=True)
 (r/project/'evidence/requirements-observed.txt').write_text(frozen,encoding='utf-8')
 if project=='eigent':info['uv_lock_sha256']=hashlib.sha256((repo/'backend/uv.lock').read_bytes()).hexdigest()
 info['xml']={}
 for f in (r/project/'evidence').glob('*.xml'):
  try:
   tree=ET.parse(f).getroot();suite=tree.find('testsuite') if tree.tag=='testsuites' else tree
   info['xml'][f.name]={k:suite.attrib.get(k) for k in ('tests','failures','errors','skipped','time')}
  except Exception as exc:info['xml'][f.name]={'parse_error':str(exc)}
 manifest['projects'][project]=info
(r/'manifest.json').write_text(json.dumps(manifest,indent=2),encoding='utf-8')
print(json.dumps(manifest,indent=2))
