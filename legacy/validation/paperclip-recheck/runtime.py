"""Falsifiable no-fork Paperclip recheck. Synthetic providers/effects only."""
import asyncio, hashlib, hmac, json, os, sqlite3, sys, time
from pathlib import Path
from typing import TypedDict, Annotated
import operator
from aiohttp import web
from langgraph.graph import StateGraph, START, END
from langgraph.checkpoint.sqlite.aio import AsyncSqliteSaver
import importlib.util
_fixture_path=Path(__file__).resolve().parents[2]/'poc/runtime.py'
_spec=importlib.util.spec_from_file_location('legacy_knowledge_fixture',_fixture_path)
_fixture=importlib.util.module_from_spec(_spec);sys.modules[_spec.name]=_fixture;_spec.loader.exec_module(_fixture)
Knowledge=_fixture.Knowledge

class Store:
    def __init__(self,path):
        self.path=str(path)
        with self.db() as db:
            db.executescript('''CREATE TABLE IF NOT EXISTS jobs(company TEXT,run TEXT,task TEXT,intent TEXT,digest TEXT,status TEXT,seq INTEGER DEFAULT 0,result TEXT,PRIMARY KEY(company,run)); CREATE TABLE IF NOT EXISTS effects(company TEXT,intent TEXT,operation TEXT,source_run TEXT,PRIMARY KEY(company,intent,operation));''')
            db.execute("UPDATE jobs SET status='recovery_required',seq=seq+1 WHERE status IN ('accepted','running','cancel_requested')")
    def db(self):return sqlite3.connect(self.path,timeout=10)
    def submit(self,p):
        stable={k:p[k] for k in ('companyId','runId','taskId','intentId','approved','delayMs')}
        digest=hashlib.sha256(json.dumps(stable,sort_keys=True).encode()).hexdigest()
        with self.db() as db:
            db.execute('BEGIN IMMEDIATE')
            old=db.execute('SELECT task,intent,digest,status FROM jobs WHERE company=? AND run=?',(p['companyId'],p['runId'])).fetchone()
            if old:
                if old[0]!=p['taskId'] or old[1]!=p['intentId'] or (old[2] and old[2]!=digest):raise ValueError('run identity conflict')
                return False
            db.execute("INSERT INTO jobs(company,run,task,intent,digest,status) VALUES(?,?,?,?,?,'accepted')",(p['companyId'],p['runId'],p['taskId'],p['intentId'],digest))
        return True
    def status(self,p):
        with self.db() as db:
            row=db.execute('SELECT status,seq,result FROM jobs WHERE company=? AND run=?',(p['companyId'],p['runId'])).fetchone()
            count=db.execute('SELECT count(*) FROM effects WHERE company=? AND intent=?',(p['companyId'],p['intentId'])).fetchone()[0]
        return {'status':row[0] if row else 'missing','seq':row[1] if row else 0,'result':json.loads(row[2]) if row and row[2] else None,'effects':count}
    def running(self,p):
        with self.db() as db:return db.execute("UPDATE jobs SET status='running',seq=seq+1 WHERE company=? AND run=? AND status='accepted'",(p['companyId'],p['runId'])).rowcount
    def effect(self,p):
        if not p['approved']:raise PermissionError('approval missing')
        with self.db() as db:
            db.execute('BEGIN IMMEDIATE')
            status=db.execute('SELECT status FROM jobs WHERE company=? AND run=?',(p['companyId'],p['runId'])).fetchone()
            if not status or status[0]!='running':raise PermissionError('effect fenced by current state')
            return db.execute('INSERT OR IGNORE INTO effects VALUES(?,?,?,?)',(p['companyId'],p['intentId'],'synthetic-email',p['runId'])).rowcount
    def settle(self,p,status,result=None):
        with self.db() as db:return db.execute("UPDATE jobs SET status=?,result=?,seq=seq+1 WHERE company=? AND run=? AND status NOT IN ('completed','cancelled','failed')",(status,json.dumps(result) if result else None,p['companyId'],p['runId'])).rowcount
    def request_cancel(self,p):
        with self.db() as db:
            db.execute('BEGIN IMMEDIATE')
            row=db.execute('SELECT status FROM jobs WHERE company=? AND run=?',(p['companyId'],p['runId'])).fetchone()
            if not row:
                db.execute("INSERT INTO jobs(company,run,task,intent,status) VALUES(?,?,?,?,'cancelled')",(p['companyId'],p['runId'],p['taskId'],p['intentId']))
            elif row[0] not in ('completed','failed','cancelled'):
                db.execute("UPDATE jobs SET status='cancel_requested',seq=seq+1 WHERE company=? AND run=?",(p['companyId'],p['runId']))
        return self.status(p)

class State(TypedDict):
    companyId:str
    runId:str
    taskId:str
    intentId:str
    approved:bool
    delayMs:int
    findings:Annotated[list,operator.add]

def graph(knowledge,store,saver):
    async def chief(s):return {'findings':[{'role':'chief_of_staff','plan':'synthetic evidence and approved effect'}]}
    async def controller(s):return {'findings':[{'role':'adaptive_controller','strategy':'A3','capabilities':['sales','campaign'],'reason':'two evidence domains'}]}
    async def sales(s):return {'findings':[{'role':'sales','source':await knowledge.query({'companyId':s['companyId'],'scopes':['knowledge:read']},s['companyId'])}]}
    async def campaign(s):return {'findings':[{'role':'campaign','source':await knowledge.query({'companyId':s['companyId'],'scopes':['knowledge:read']},s['companyId'])}]}
    async def review(s):
        await asyncio.sleep(s['delayMs']/1000)
        store.effect(s)
        return {'findings':[{'role':'review','synthetic_effect':'committed under stable intent'}]}
    g=StateGraph(State)
    for name,fn in [('chief',chief),('controller',controller),('sales',sales),('campaign',campaign),('review',review)]:g.add_node(name,fn)
    g.add_edge(START,'chief');g.add_edge('chief','controller');g.add_edge('controller','sales');g.add_edge('controller','campaign');g.add_edge(['sales','campaign'],'review');g.add_edge('review',END)
    return g.compile(checkpointer=saver)

async def main():
    root=Path(os.environ['RECHECK_DATA_DIR']);root.mkdir(parents=True,exist_ok=True)
    key=bytes.fromhex(os.environ['POC_SIGNING_KEY']);store=Store(root/'jobs.sqlite')
    knowledge=Knowledge(root/'knowledge');await knowledge.start()
    active={};locks={}
    async with AsyncSqliteSaver.from_conn_string(str(root/'checkpoints.sqlite')) as saver:
        g=graph(knowledge,store,saver)
        async def execute(p):
            if not store.running(p):return
            try:
                result=await g.ainvoke({**p,'findings':[]},{'configurable':{'thread_id':p['companyId']+':'+p['runId']}})
                store.settle(p,'completed',{'findings':result['findings']})
            except asyncio.CancelledError:store.settle(p,'cancelled');raise
            except Exception as exc:store.settle(p,'failed',{'error':type(exc).__name__})
        async def rpc(request):
            raw=await request.read()
            signature=request.headers.get('x-poc-signature','')
            if not hmac.compare_digest(hmac.new(key,raw,hashlib.sha256).hexdigest(),signature):return web.json_response({'error':'bad signature'},status=403)
            try:
                p=json.loads(raw)
                if abs(time.time()-p['issuedAt'])>60 or p['companyId'] not in ('A','B',os.environ.get('POC_COMPANY_A')):raise PermissionError()
                if not isinstance(p['delayMs'],int) or not 0<=p['delayMs']<=5000:raise ValueError('delay outside fixture limits')
                identity=(p['companyId'],p['runId'])
                async with locks.setdefault(identity,asyncio.Lock()):
                    action=p['action']
                    if action=='submit':
                        if store.submit(p):active[identity]=asyncio.create_task(execute(p))
                    elif action=='cancel':
                        store.request_cancel(p)
                        task=active.get(identity)
                        if task and not task.done():task.cancel();await asyncio.gather(task,return_exceptions=True)
                        if store.status(p)['status']=='cancel_requested':store.settle(p,'cancelled')
                    elif action!='status':raise ValueError('unknown action')
                    status=store.status(p)
                    status['terminated']=identity not in active or active[identity].done()
                    status['usage']={'inputTokens':30,'outputTokens':5} if status['status']=='completed' else {'inputTokens':0,'outputTokens':0}
                    status['usageByModel']=[{'model':'fixture-sales','usage':{'inputTokens':10,'outputTokens':2},'costUsd':0.001},{'model':'fixture-campaign','usage':{'inputTokens':20,'outputTokens':3},'costUsd':0.002}] if status['status']=='completed' else []
                    status['costUsd']=0.003 if status['status']=='completed' else 0
                    return web.json_response(status,status=202 if action=='submit' else 200)
            except PermissionError:return web.json_response({'error':'denied'},status=403)
            except (ValueError,KeyError):return web.json_response({'error':'invalid or conflicting context'},status=409)
        app=web.Application();app.router.add_post('/rpc',rpc)
        runner=web.AppRunner(app);await runner.setup();site=web.TCPSite(runner,'127.0.0.1',0);await site.start()
        print(json.dumps({'ready':True,'port':site._server.sockets[0].getsockname()[1]}),flush=True)
        try:await asyncio.Event().wait()
        finally:
            for task in active.values():task.cancel()
            await asyncio.gather(*active.values(),return_exceptions=True)
            await runner.cleanup();await knowledge.close()

if __name__=='__main__':asyncio.run(main())
