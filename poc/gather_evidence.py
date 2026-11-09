from pathlib import Path
import subprocess,json,hashlib,datetime,urllib.request,importlib.metadata as md
root=Path.cwd();p=root/'poc';e=p/'evidence'; repos={}
for name in ('paperclip','langgraph','lightrag'):
    repo=root/'vendor'/name
    def git(*args):return subprocess.check_output(['git','-C',str(repo),*args],text=True).strip()
    repos[name]={'sha':git('rev-parse','HEAD'),'remote':git('remote','get-url','origin'),'tracked_changes':git('status','--short','--untracked-files=no'),'license_sha256':hashlib.sha256((repo/'LICENSE').read_bytes()).hexdigest()}
repos['paperclip']['lock_sha256']=hashlib.sha256((root/'vendor/paperclip/pnpm-lock.yaml').read_bytes()).hexdigest()
versions={n:md.version(n) for n in ('langgraph','langgraph-checkpoint','langgraph-checkpoint-sqlite','langgraph-sdk','lightrag-hku','pytest','pytest-asyncio','numpy')}
manifest={'captured_utc':datetime.datetime.now(datetime.timezone.utc).isoformat(),'repositories':repos,'python_packages':versions,'environment':{'os':'Windows','python':subprocess.check_output([__import__('sys').executable,'--version'],text=True).strip(),'node':'v24.20.0','git':'2.55.0.windows.5','docker_cli':'29.8.1','docker_compose':'v5.5.1','docker_daemon':'unavailable at reconnaissance','pnpm_initial':'11.25.0','pnpm_used':'9.15.4','initial_workspace':'empty','initial_sandbox':'read-only; network and writes executed with explicit tool escalation','network_initial':'github.com DNS resolution failed in sandbox; escalated clone succeeded'},'upstream_inventory':{'server_test_files':len(list((root/'vendor/paperclip/server/src').rglob('*.test.ts'))),'migrations_sql':len(list((root/'vendor/paperclip/packages/db/src/migrations').glob('*.sql')))}}
(e/'manifest.json').write_text(json.dumps(manifest,indent=2),encoding='utf-8')
freeze=subprocess.check_output([__import__('sys').executable,'-m','pip','freeze'],text=True)
local={'langgraph':'./vendor/langgraph/libs/langgraph','langgraph-checkpoint':'./vendor/langgraph/libs/checkpoint','langgraph-checkpoint-sqlite':'./vendor/langgraph/libs/checkpoint-sqlite','langgraph-prebuilt':'./vendor/langgraph/libs/prebuilt','langgraph-sdk':'./vendor/langgraph/libs/sdk-py','lightrag-hku':'./vendor/lightrag'}
lines=[]
for line in freeze.splitlines():
    if ' @ file:' in line:
        name=line.split(' @ ')[0];line=local.get(name,line)
    lines.append(line)
(p/'requirements.lock.txt').write_text('# Resolve from workspace root; source repositories pinned in evidence/manifest.json\n'+'\n'.join(lines)+'\n',encoding='utf-8')
(e/'python-direct-provenance.json').write_text(json.dumps({name:json.loads(md.distribution(name).read_text('direct_url.json')) for name in local},indent=2),encoding='utf-8')
queries={
'paperclip/server/src/routes/issues.ts':['queueIssueAssignmentWakeup({','"/issues/:id",'],
'paperclip/server/src/services/issue-assignment-wakeup.ts':['if (!input.issue.assigneeAgentId','source: "assignment"'],
'paperclip/server/src/services/issues.ts':['checkout: async (','const updated = await db.transaction','executionLockCondition'],
'paperclip/server/src/services/heartbeat/queue.ts':['function createHeartbeatQueue','async function startNextQueuedRunForAgent','async function resumeQueuedRuns','claimQueued'],
'paperclip/server/src/services/heartbeat/runtime-execution.ts':['const authToken =','adapter.execute({','usageRecorder.complete'],
'paperclip/server/src/services/heartbeat/run-completion.ts':['(adapterResult.exitCode ?? 0)','const usageJson:','costUsd: adapterResult.costUsd'],
'paperclip/server/src/services/heartbeat/recovery.ts':['async function reapOrphanedRuns','nativeProcessGroupAlive','processGroupAlive'],
'paperclip/server/src/adapters/http/execute.ts':['const timeoutMs','const body =','if (!res.ok)','exitCode: 0'],
'paperclip/server/src/adapters/http/remote-fetch.ts':['PRIVATE_ENDPOINT_ALLOWLIST_ENV','allowPrivateNetwork:'],
'paperclip/server/src/adapters/plugin-loader.ts':['const adapterModule = createServerAdapter()','export async function loadExternalAdapterPackage'],
'paperclip/server/src/routes/adapters.ts':['router.post("/adapters/install"','registerWithSessionManagement'],
'paperclip/server/src/middleware/auth.ts':['function hashToken','verifyLocalAgentJwt','agentRunWritesRevoked'],
'paperclip/server/src/services/authorization.ts':['if (input.actor.companyId !== companyId)','input.actor.keyScope?.kind === "skill_test"'],
'paperclip/server/src/services/budgets.ts':['function observedBlocks','export async function policyBlocks','Available budget is reserved'],
'paperclip/packages/db/src/schema/companies.ts':['requireBoardApprovalForNewAgents','default(false)'],
'paperclip/packages/db/src/schema/agents.ts':['reportsTo:'],
'paperclip/server/src/routes/agents.ts':['company.requireBoardApprovalForNewAgents && !req.body.setupId','router.post("/agents/:id/keys"','router.post("/agents/:id/heartbeat/invoke"'],
'paperclip/packages/adapter-utils/src/types.ts':['export interface AdapterExecutionResult','usageByModel?:','signal?: AbortSignal','authToken?:'],
'paperclip/packages/shared/src/telemetry/config.ts':['PAPERCLIP_TELEMETRY_DISABLED'],
'paperclip/server/src/index.ts':['password: "paperclip"','mode: "embedded-postgres"'],
'lightrag/lightrag/lightrag.py':['async def aquery_data(','async def ainsert_custom_kg(','This path is OUTSIDE the document-level recovery guarantee'],
'lightrag/lightrag/base.py':['class QueryParam:'],
'langgraph/libs/checkpoint-sqlite/langgraph/checkpoint/sqlite/aio.py':['class AsyncSqliteSaver'],
}
trace=['# Source trace at pinned commits','Generated from local source; excerpts are static evidence, not execution proof.','']
for name,patterns in queries.items():
    file=root/'vendor'/name
    if not file.exists():trace.append(f'MISSING {name}');continue
    data=file.read_text(encoding='utf-8').splitlines()
    for pat in patterns:
        found=next((i for i,line in enumerate(data) if pat in line),None)
        if found is None:trace.append(f'NOT FOUND `{name}` pattern `{pat}`');continue
        project=name.split('/')[0];sha=repos[project]['sha'];remote=repos[project]['remote'].removesuffix('.git')
        rel=name[len(project)+1:]
        trace+= [f'## [{name}:{found+1}]({remote}/blob/{sha}/{rel}#L{found+1})','```text']+[f'{i+1}: {data[i]}' for i in range(max(0,found-1),min(len(data),found+5))]+['```','']
(p/'SOURCE_TRACE.md').write_text('\n'.join(trace),encoding='utf-8')
metrics=[]
for repo in ('paperclipai/paperclip','langchain-ai/langgraph','HKUDS/LightRAG'):
    try:
        req=urllib.request.Request('https://api.github.com/repos/'+repo,headers={'User-Agent':'local-audit-poc'})
        with urllib.request.urlopen(req,timeout=20) as response: obj=json.load(response)
        metrics.append({'repo':repo,'captured_utc':datetime.datetime.now(datetime.timezone.utc).isoformat(),**{key:obj.get(key) for key in ('stargazers_count','forks_count','open_issues_count','default_branch','pushed_at','license')}})
    except Exception as exc:metrics.append({'repo':repo,'error':str(exc)})
(e/'github-metrics.json').write_text(json.dumps(metrics,indent=2),encoding='utf-8')
print(json.dumps(manifest,indent=2))
