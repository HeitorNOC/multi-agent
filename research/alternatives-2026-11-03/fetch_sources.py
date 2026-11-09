from pathlib import Path
import urllib.request,json,datetime,hashlib,concurrent.futures
root=Path('research/alternatives-2026-11-03'); out=root/'sources';out.mkdir(exist_ok=True)
repos=['eigent-ai/eigent','camel-ai/camel','openagents-org/openagents','agentscope-ai/agentscope','zeenie-ai/OpenCompany','useopencompany/opencompany','langchain-ai/open-agent-platform','onyx-dot-app/onyx','crewAIInc/crewAI','langgenius/dify']
def request(url):
 req=urllib.request.Request(url,headers={'User-Agent':'enterprise-multiagent-research'})
 with urllib.request.urlopen(req,timeout=35) as response:return response.read()
def fetch(repo):
 result={'repo':repo,'captured_utc':datetime.datetime.now(datetime.timezone.utc).isoformat(),'files':[]}
 try:
  meta=json.loads(request('https://api.github.com/repos/'+repo));branch=meta['default_branch']
  commit=json.loads(request('https://api.github.com/repos/'+repo+'/commits/'+branch));sha=commit['sha']
  result.update(sha=sha,default_branch=branch,archived=meta['archived'],license=(meta.get('license') or {}).get('spdx_id'),stars=meta['stargazers_count'])
  tree=json.loads(request(f'https://api.github.com/repos/{repo}/git/trees/{sha}?recursive=1')); paths=[x['path'] for x in tree.get('tree',[]) if x['type']=='blob']
  result['tree_truncated']=tree.get('truncated');result['paths']=paths
  selected=[x for x in ['README.md','LICENSE','LICENSE.md','LICENSE.txt','package.json','pyproject.toml','backend/pyproject.toml','api/pyproject.toml','workspace/README.md','workspace/backend/requirements.txt','libs/crewai/pyproject.toml','backend/requirements/default.txt'] if x in paths]
  folder=out/repo.replace('/','__');folder.mkdir(exist_ok=True)
  for path in selected:
   try:
    body=request(f'https://raw.githubusercontent.com/{repo}/{sha}/{path}')
    dest=folder/path;dest.parent.mkdir(parents=True,exist_ok=True);dest.write_bytes(body)
    result['files'].append({'path':path,'sha256':hashlib.sha256(body).hexdigest(),'url':f'https://github.com/{repo}/blob/{sha}/{path}'})
   except Exception as exc:result['files'].append({'path':path,'error':str(exc)})
 except Exception as exc:result['error']=str(exc)
 return result
with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:results=list(pool.map(fetch,repos))
(root/'inventory.json').write_text(json.dumps(results,indent=2),encoding='utf-8')
for r in results: print(json.dumps({k:v for k,v in r.items() if k not in ('paths','files')}), 'files',len(r['files']))
