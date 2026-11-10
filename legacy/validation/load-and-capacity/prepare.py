from pathlib import Path
P=Path(__file__).parent
def edit(name,fn):
    f=P/name;f.write_text(fn(f.read_text(encoding='utf-8')),encoding='utf-8')
def app(s):
    s=s.replace('from maintenance import Maintenance','from maintenance import Maintenance\nfrom read_profile import ReadProfile')
    s=s.replace('class API(Maintenance,Coordination,Freshness,Controls):','class API(ReadProfile,Maintenance,Coordination,Freshness,Controls):')
    s=s.replace("[('politica-remoto','publico'),('aquisicao','financeiro')]", "json.loads((Path(__file__).parent/'registry.json').read_text(encoding='utf-8')).items()")
    s=s.replace("    app=web.Application(middlewares=[guard]);",'''    @web.middleware
    async def metrics(req,handler):
        started=time.perf_counter();status=500
        try:
            result=await handler(req);status=result.status;return result
        except web.HTTPException as e:status=e.status;raise
        finally:
            row={'phase':req.headers.get('x-audit-phase','unspecified'),'path':req.path,'method':req.method,'status':status,
                 'seconds':time.perf_counter()-started,'queue_seconds':req.get('queue_seconds',0),'instance':c['instance']}
            with (Path(c['evidence'])/('http-'+c['instance']+'.jsonl')).open('a',encoding='utf-8') as f:f.write(json.dumps(row)+'\\n')
    app=web.Application(middlewares=[metrics,guard]);''')
    return s
edit('application.py',app)
edit('editorial.ts',lambda s:s.replace("{ 'politica-remoto': 'publico', 'aquisicao': 'financeiro' }", "JSON.parse(readFileSync(new URL('./registry.json',import.meta.url),'utf8'))"))
edit('controls.py',lambda s:s.replace("        ticket=await self.fresh_begin('decision'", "        if self.c.get('quota_preflight'):\n            budget=(await self.authority_request(action='proof'))['budgets']['model']\n            if budget['reserved']>=budget['cap']:raise web.HTTPTooManyRequests(text='attempt quota exhausted before admission; no inference started')\n        ticket=await self.fresh_begin('decision'"))
def coordination(s):
    s=s.replace('            deadline=time.monotonic()+180', '            queued=time.perf_counter()\n            deadline=time.monotonic()+180')
    s=s.replace("            self.recovering=bool(await self.db.fetchval('SELECT recovering FROM recovery_control WHERE id'))\n            if await self.db.fetchval('SELECT frozen", "            req['queue_seconds']=time.perf_counter()-queued\n            self.recovering=bool(await self.db.fetchval('SELECT recovering FROM recovery_control WHERE id'))\n            if await self.db.fetchval('SELECT frozen")
    return s
edit('coordination.py',coordination)
def harness(s):
    s=s.replace("'restore-state-audit-'","'load-audit-'")
    s=s.replace("        self.app_config['instance']=uuid.uuid4().hex", "        self.app_config['instance']=uuid.uuid4().hex\n        self.app_config.update(parallel_history=getattr(self,'parallel_history',False),quota_preflight=getattr(self,'quota_preflight',False),retrieval_mode=getattr(self,'retrieval_mode','mix'))")
    return s
edit('harness.py',harness)
