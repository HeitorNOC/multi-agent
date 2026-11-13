from pathlib import Path
import json,urllib.request,hashlib,concurrent.futures
r=Path('research/alternatives-2026-11-03');items=json.loads((r/'inventory.json').read_text()); by={x['repo']:x for x in items}
extra={
'eigent-ai/eigent':['backend/app/agent/factory/managed_workforce.py','backend/app/utils/workforce.py'],
'zeenie-ai/OpenCompany':['server/pyproject.toml','docs-internal/agent_architecture.md','docs-internal/employee_teams.md','docs-internal/TEMPORAL_ARCHITECTURE.md','docs-internal/temporal-workflow-control.md'],
'useopencompany/opencompany':['docs/architecture.md','packages/agent/package.json','apps/runner/package.json'],
'openagents-org/openagents':['docs/concepts/architecture.mdx','docs/tutorials/agent-groups-permissions.mdx'],
'agentscope-ai/agentscope':['src/agentscope/pipeline/_team_pipeline.py','tests/pipeline_team_cleanup_test.py'],
'crewAIInc/crewAI':['lib/crewai/pyproject.toml','docs/edge/en/concepts/production-architecture.mdx'],
'onyx-dot-app/onyx':['backend/ee/LICENSE','backend/onyx/auth/permissions.py']}
def fetch(pair):
 repo,path=pair;x=by[repo];url=f'https://raw.githubusercontent.com/{repo}/{x["sha"]}/{path}'
 try:
  request=urllib.request.Request(url,headers={'User-Agent':'enterprise-multiagent-research'})
  with urllib.request.urlopen(request,timeout=25) as resp:body=resp.read()
  dest=r/'sources'/repo.replace('/','__')/path;dest.parent.mkdir(parents=True,exist_ok=True);dest.write_bytes(body)
  return repo,{'path':path,'sha256':hashlib.sha256(body).hexdigest(),'url':f'https://github.com/{repo}/blob/{x["sha"]}/{path}'}
 except Exception as exc:return repo,{'path':path,'error':str(exc)}
with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
 for repo,item in pool.map(fetch,[(repo,p) for repo,paths in extra.items() for p in paths]):by[repo]['files'].append(item)
(r/'inventory.json').write_text(json.dumps(items,indent=2),encoding='utf-8')
for repo,paths in extra.items():print(repo,[(x['path'],x.get('error','OK')) for x in by[repo]['files'] if x['path'] in paths])
