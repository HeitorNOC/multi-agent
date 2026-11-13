"""Shared enterprise/knowledge/effect fixture. Synthetic cost units, not USD."""
import asyncio
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import secrets
import sqlite3
import sys
from aiohttp import web

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location('knowledge_fixture', ROOT/'poc/runtime.py')
fixture = importlib.util.module_from_spec(spec)
spec.loader.exec_module(fixture)


class Ledger:
    def __init__(self, root):
        self.path = root/'control.sqlite'
        self.provider_path = root/'provider.sqlite'
        with self.db() as db:
            db.executescript('''
            CREATE TABLE IF NOT EXISTS accounts(period TEXT PRIMARY KEY,budget INTEGER,spent INTEGER DEFAULT 0,held INTEGER DEFAULT 0);
            CREATE TABLE IF NOT EXISTS runs(id TEXT PRIMARY KEY,engine TEXT,company TEXT,period TEXT,intent TEXT,state TEXT,held INTEGER DEFAULT 0,actual INTEGER DEFAULT 0,plan TEXT,approval TEXT,fault TEXT,delay REAL DEFAULT 0);
            CREATE TABLE IF NOT EXISTS tokens(hash TEXT PRIMARY KEY,run TEXT,company TEXT,scopes TEXT,revoked INTEGER DEFAULT 0);
            CREATE TABLE IF NOT EXISTS findings(run TEXT,capability TEXT,data TEXT,PRIMARY KEY(run,capability));
            CREATE TABLE IF NOT EXISTS charges(run TEXT,operation TEXT,units INTEGER,PRIMARY KEY(run,operation));
            CREATE TABLE IF NOT EXISTS audit(seq INTEGER PRIMARY KEY AUTOINCREMENT,run TEXT,event TEXT,detail TEXT);
            CREATE TABLE IF NOT EXISTS outbox(id TEXT PRIMARY KEY,run TEXT,payload TEXT);
            CREATE TABLE IF NOT EXISTS inbox(id TEXT PRIMARY KEY,payload TEXT);
            ''')
        with sqlite3.connect(self.provider_path) as db:
            db.execute('CREATE TABLE IF NOT EXISTS deliveries(key TEXT PRIMARY KEY,run TEXT,receipt TEXT)')

    def db(self):
        db = sqlite3.connect(self.path, timeout=15)
        db.row_factory = sqlite3.Row
        return db

    def event(self, db, run, name, detail=None):
        db.execute('INSERT INTO audit(run,event,detail) VALUES(?,?,?)', (run,name,json.dumps(detail)))

    def charge(self, db, run, operation, units):
        if db.execute('SELECT 1 FROM charges WHERE run=? AND operation=?',(run,operation)).fetchone():
            return
        r = db.execute('SELECT * FROM runs WHERE id=?',(run,)).fetchone()
        released = min(r['held'], units)
        db.execute('INSERT INTO charges VALUES(?,?,?)',(run,operation,units))
        db.execute('UPDATE accounts SET spent=spent+?,held=held-? WHERE period=?',(units,released,r['period']))
        db.execute('UPDATE runs SET actual=actual+?,held=held-? WHERE id=?',(units,released,run))
        if units > r['held']:
            db.execute("UPDATE runs SET state='budget_exceeded' WHERE id=?",(run,))
        self.event(db,run,'synthetic_usage',{'operation':operation,'units':units})

    def release(self, db, run, status):
        r = db.execute('SELECT * FROM runs WHERE id=?',(run,)).fetchone()
        db.execute('UPDATE accounts SET held=held-? WHERE period=?',(r['held'],r['period']))
        db.execute('UPDATE runs SET held=0,state=? WHERE id=?',(status,run))
        self.event(db,run,status)

    def snapshot(self, run):
        with self.db() as db:
            r = dict(db.execute('SELECT * FROM runs WHERE id=?',(run,)).fetchone())
            r['findings'] = {x['capability']:json.loads(x['data']) for x in db.execute('SELECT * FROM findings WHERE run=?',(run,))}
            r['charges'] = [dict(x) for x in db.execute('SELECT * FROM charges WHERE run=?',(run,))]
            r['audit'] = [dict(x) for x in db.execute('SELECT seq,event,detail FROM audit WHERE run=? ORDER BY seq',(run,))]
            r['account'] = dict(db.execute('SELECT * FROM accounts WHERE period=?',(r['period'],)).fetchone())
            r['outbox'] = [dict(x) for x in db.execute('SELECT * FROM outbox WHERE run=?',(run,))]
        with sqlite3.connect(self.provider_path) as db:
            r['deliveries'] = db.execute('SELECT count(*) FROM deliveries WHERE key=?',(r['company']+':'+r['intent']+':email-v1',)).fetchone()[0]
        return r


async def main():
    root = Path(os.environ['COMPARISON_DATA']);root.mkdir(parents=True,exist_ok=True)
    ledger = Ledger(root)
    knowledge = fixture.Knowledge(root/'knowledge')
    await knowledge.start()
    board = os.environ['COMPARISON_BOARD_TOKEN']

    @web.middleware
    async def errors(req, handler):
        try:
            return await handler(req)
        except (PermissionError,ValueError,KeyError) as error:
            return web.json_response({'error':str(error)},status=403 if isinstance(error,PermissionError) else 409)

    def identity(req, board_only=False):
        value=req.headers.get('Authorization','').removeprefix('Bearer ')
        if secrets.compare_digest(value,board):
            if board_only:return {'board':True}
            raise PermissionError('board credential is not an execution identity')
        if board_only:raise PermissionError('human board approval identity required')
        with ledger.db() as db:
            token=db.execute('SELECT * FROM tokens WHERE hash=?',(hashlib.sha256(value.encode()).hexdigest(),)).fetchone()
        if not token or token['revoked']:raise web.HTTPUnauthorized(text='invalid or revoked execution token')
        return {**dict(token),'scopes':json.loads(token['scopes'])}

    async def create(req):
        identity(req,True);p=await req.json();token=secrets.token_hex(32)
        if p['company'] not in ('A','B') or p['engine'] not in ('langgraph','agentscope'):raise ValueError('unknown fixture company/engine')
        p['period']=p['company']+':'+p['period']
        if not set(p.get('scopes',['knowledge:read','email:send'])) <= {'knowledge:read','email:send'}:raise ValueError('unknown scope')
        with ledger.db() as db:
            db.execute('BEGIN IMMEDIATE')
            db.execute('INSERT OR IGNORE INTO accounts(period,budget) VALUES(?,?)',(p['period'],p.get('monthly_limit',100)))
            db.execute("INSERT INTO runs(id,engine,company,period,intent,state,fault,delay) VALUES(?,?,?,?,?,'created',?,?)",(p['run'],p['engine'],p['company'],p['period'],p.get('intent',p['run']),p.get('fault',''),p.get('delay',0)))
            db.execute('INSERT INTO tokens(hash,run,company,scopes) VALUES(?,?,?,?)',(hashlib.sha256(token.encode()).hexdigest(),p['run'],p['company'],json.dumps(p.get('scopes',['knowledge:read','email:send']))))
            ledger.event(db,p['run'],'created',{'controller':'own layer','strategy':'A3','capabilities':['sales','campaign'],'reason':'two evidence domains','task_reservation':4})
        return web.json_response({'run':p['run'],'token':token})

    async def begin(req):
        who=identity(req)
        with ledger.db() as db:
            db.execute('BEGIN IMMEDIATE');r=db.execute('SELECT * FROM runs WHERE id=?',(who['run'],)).fetchone()
            if r['state']=='created':
                account=db.execute('SELECT * FROM accounts WHERE period=?',(r['period'],)).fetchone()
                if account['spent']+account['held']+4>account['budget']:raise PermissionError('aggregate monthly reservation exhausted')
                db.execute('UPDATE accounts SET held=held+4 WHERE period=?',(r['period'],))
                db.execute("UPDATE runs SET held=4,state='running' WHERE id=?",(who['run'],));ledger.event(db,who['run'],'running')
            elif r['state'] not in ('running','waiting_approval','approved','effect_pending','completed'):
                raise PermissionError('run is fenced: '+r['state'])
        return web.json_response(ledger.snapshot(who['run']))

    async def retrieve(req):
        who=identity(req);p=await req.json();capability=p['capability']
        if capability not in ('sales','campaign') or p['company']!=who['company'] or 'knowledge:read' not in who['scopes']:
            raise PermissionError('knowledge denied before retrieval')
        with ledger.db() as db:
            db.execute('BEGIN IMMEDIATE');r=db.execute('SELECT * FROM runs WHERE id=?',(who['run'],)).fetchone()
            if r['state']!='running':raise PermissionError('knowledge fenced by current execution state')
            cached=db.execute('SELECT data FROM findings WHERE run=? AND capability=?',(who['run'],capability)).fetchone()
            ledger.event(db,who['run'],'knowledge_request',{'capability':capability,'cache':bool(cached)})
            if cached:return web.json_response(json.loads(cached[0]))
            ledger.charge(db,who['run'],'knowledge:'+capability,5 if r['fault']=='cost_overrun' else 1)
            current=db.execute('SELECT state FROM runs WHERE id=?',(who['run'],)).fetchone()[0]
        if current=='budget_exceeded':raise PermissionError('provider overrun recorded; execution stopped')
        await asyncio.sleep(r['delay'])
        data=await knowledge.query({'companyId':who['company'],'scopes':who['scopes']},p['company'])
        chunks=data.get('data',{}).get('chunks',[])
        if data.get('status')!='success' or not chunks:raise ValueError('LightRAG returned no verifiable evidence')
        result={'capability':capability,'company':who['company'],'retrieval':'LightRAG aquery_data naive; fixture vectors',
                'sources':[{'chunk_id':x.get('chunk_id'),'file_path':x.get('file_path'),'version':1,
                            'content':x['content'],'provenance':'synthetic fixture ingestion'} for x in chunks]}
        if any('SECRET_'+('B' if who['company']=='A' else 'A') in x['content'] for x in result['sources']):raise PermissionError('cross company retrieval leak')
        with ledger.db() as db:
            db.execute('BEGIN IMMEDIATE');state=db.execute('SELECT state FROM runs WHERE id=?',(who['run'],)).fetchone()[0]
            if state!='running':raise PermissionError('result fenced after cancellation')
            db.execute('INSERT OR IGNORE INTO findings VALUES(?,?,?)',(who['run'],capability,json.dumps(result)))
            ledger.event(db,who['run'],'finding_persisted',{'capability':capability})
        return web.json_response(result)

    async def analysis(req):
        who=identity(req)
        with ledger.db() as db:
            db.execute('BEGIN IMMEDIATE');r=db.execute('SELECT * FROM runs WHERE id=?',(who['run'],)).fetchone()
            if r['state'] in ('waiting_approval','approved','completed'):return web.json_response(ledger.snapshot(who['run']))
            if r['state']!='running':raise PermissionError('analysis fenced')
            findings=[json.loads(x[0]) for x in db.execute('SELECT data FROM findings WHERE run=? ORDER BY capability',(who['run'],))]
            if len(findings)!=2:raise ValueError('two reviewed evidence domains required')
            plan={'company':who['company'],'run':who['run'],'operation':'email-v1','intent':r['intent'],'findings':findings}
            digest=hashlib.sha256(json.dumps(plan,sort_keys=True).encode()).hexdigest()
            db.execute("UPDATE runs SET plan=?,state='waiting_approval' WHERE id=?",(digest,who['run']))
            ledger.event(db,who['run'],'waiting_approval',{'plan_digest':digest})
        return web.json_response(ledger.snapshot(who['run']))

    async def approve(req):
        identity(req,True);p=await req.json()
        with ledger.db() as db:
            db.execute('BEGIN IMMEDIATE');r=db.execute('SELECT * FROM runs WHERE id=?',(p['run'],)).fetchone()
            if r['state']!='waiting_approval' or p['plan']!=r['plan']:raise PermissionError('approval does not match current immutable plan')
            db.execute("UPDATE runs SET approval=?,state='approved' WHERE id=?",(p['plan'],p['run']))
            ledger.event(db,p['run'],'human_approved',{'actor':'synthetic-human-board','plan':p['plan']})
        return web.json_response({'approved':True})

    async def effect(req):
        who=identity(req)
        if 'email:send' not in who['scopes']:raise PermissionError('effect scope missing')
        with ledger.db() as db:
            db.execute('BEGIN IMMEDIATE');r=db.execute('SELECT * FROM runs WHERE id=?',(who['run'],)).fetchone()
            if r['state']=='completed':return web.json_response(ledger.snapshot(who['run']))
            if r['state'] not in ('approved','effect_pending') or not r['approval'] or r['approval']!=r['plan']:raise PermissionError('effect requires current approval and active run')
            if r['held']<1:raise PermissionError('effect has no financial reservation')
            db.execute("UPDATE runs SET state='effect_pending' WHERE id=?",(who['run'],))
            ledger.event(db,who['run'],'effect_pending')
        key=r['company']+':'+r['intent']+':email-v1'
        # Independent simulated external provider, with documented idempotency + lookup.
        with sqlite3.connect(ledger.provider_path) as provider:
            provider.execute('BEGIN IMMEDIATE')
            existing=provider.execute('SELECT run,receipt FROM deliveries WHERE key=?',(key,)).fetchone()
            if not existing:
                receipt=secrets.token_hex(8);provider.execute('INSERT INTO deliveries VALUES(?,?,?)',(key,who['run'],receipt))
            else:receipt=existing[1]
        if r['fault']=='after_effect' and not existing:
            raise web.HTTPServiceUnavailable(text='synthetic acknowledgement loss after provider commit')
        with ledger.db() as db:
            db.execute('BEGIN IMMEDIATE')
            current=db.execute('SELECT * FROM runs WHERE id=?',(who['run'],)).fetchone()
            if current['state'] not in ('effect_pending','completed'):raise PermissionError('effect reconciliation held after stop')
            ledger.charge(db,who['run'],'email-v1',1 if not existing or existing[0]==who['run'] else 0)
            ledger.release(db,who['run'],'completed')
            event={'event_id':who['run']+':result:v1','run_id':who['run'],'company':who['company'],'receipt':receipt,'plan':r['plan']}
            db.execute('INSERT OR IGNORE INTO outbox VALUES(?,?,?)',(event['event_id'],who['run'],json.dumps(event)))
        return web.json_response(ledger.snapshot(who['run']))

    async def board_action(req):
        identity(req,True);p=await req.json();run=p['run']
        with ledger.db() as db:
            db.execute('BEGIN IMMEDIATE');r=db.execute('SELECT * FROM runs WHERE id=?',(run,)).fetchone()
            if req.path=='/cancel':
                if r['state']=='effect_pending':raise PermissionError('uncertain external delivery must be reconciled before cancellation settles')
                if r['state'] not in ('completed','cancelled'):db.execute("UPDATE runs SET state='cancel_requested' WHERE id=?",(run,));ledger.event(db,run,'cancel_requested')
            elif req.path=='/settle-cancel':
                if r['state']!='cancel_requested' or not p.get('host_observed_worker_exit'):raise PermissionError('host termination acknowledgement required')
                ledger.release(db,run,'cancelled')
            elif req.path=='/revoke':db.execute('UPDATE tokens SET revoked=1 WHERE run=?',(run,));ledger.event(db,run,'token_revoked')
            elif req.path=='/consume':
                event=p['event'];old=db.execute('SELECT payload FROM inbox WHERE id=?',(event['event_id'],)).fetchone();raw=json.dumps(event,sort_keys=True)
                if old and old[0]!=raw:raise ValueError('business event identity collision')
                inserted=db.execute('INSERT OR IGNORE INTO inbox VALUES(?,?)',(event['event_id'],raw)).rowcount
                return web.json_response({'applied':bool(inserted),'total':db.execute('SELECT count(*) FROM inbox WHERE id=?',(event['event_id'],)).fetchone()[0]})
        return web.json_response(ledger.snapshot(run))

    async def status(req):
        who=identity(req);return web.json_response(ledger.snapshot(who['run']))

    app=web.Application(middlewares=[errors])
    for path,fn in [('/create',create),('/begin',begin),('/knowledge',retrieve),('/analysis',analysis),('/approve',approve),('/effect',effect),('/cancel',board_action),('/settle-cancel',board_action),('/revoke',board_action),('/consume',board_action)]:app.router.add_post(path,fn)
    app.router.add_get('/status',status)
    runner=web.AppRunner(app);await runner.setup();site=web.TCPSite(runner,'127.0.0.1',0);await site.start()
    print(json.dumps({'ready':True,'port':site._server.sockets[0].getsockname()[1]}),flush=True)
    try:await asyncio.Event().wait()
    finally:await runner.cleanup();await knowledge.close()


if __name__=='__main__':asyncio.run(main())
