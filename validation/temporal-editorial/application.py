"""Authenticated qualification API: native Graphiti SDK behind editorial approval and source grants."""
import asyncio,hashlib,hmac,json,os,re,sys,time
from datetime import datetime,timezone
from pathlib import Path
import aiohttp,asyncpg,jwt
from aiohttp import web
from pydantic import BaseModel,Field
from graphiti_core import Graphiti
from graphiti_core.driver.neo4j_driver import Neo4jDriver
from graphiti_core.nodes import EpisodeType
from graphiti_core.search.search_filters import SearchFilters,DateFilter,ComparisonOperator as Op
from graphiti_adapters import GraphitiCodex,OnnxEmbedder,UnusedCrossEncoder

class Company(BaseModel):pass
class Policy(BaseModel):pass
class RemotePolicy(BaseModel):
    dias_remotos:int|None=Field(default=None,description='Número de dias remotos por semana expressamente informado na fonte; null se ausente.')

def date(s):
    parsed=datetime.fromisoformat(s.replace('Z','+00:00'))
    if parsed.tzinfo is None:raise ValueError('timezone required')
    return parsed

class API:
    def __init__(self,c):self.c=c;self.lock=asyncio.Lock()
    async def start(self):
        async def codec(conn):
            for t in ('json','jsonb'):await conn.set_type_codec(t,encoder=json.dumps,decoder=json.loads,schema='pg_catalog')
        self.db=await asyncpg.create_pool(self.c['dsn'],min_size=1,max_size=4,init=codec)
        await self.db.execute('''CREATE TABLE IF NOT EXISTS principals(id TEXT PRIMARY KEY,name TEXT,role TEXT,enabled BOOL DEFAULT TRUE);
          CREATE TABLE IF NOT EXISTS sources(id TEXT PRIMARY KEY,domain TEXT);
          CREATE TABLE IF NOT EXISTS grants(principal TEXT,source TEXT,PRIMARY KEY(principal,source));
          CREATE TABLE IF NOT EXISTS publications(draft TEXT PRIMARY KEY,source TEXT,version INTEGER,domain TEXT,status TEXT,
          episode TEXT,payload JSONB,known_at TIMESTAMPTZ,UNIQUE(source,version));''')
        for p in self.c['principals']:await self.db.execute('INSERT INTO principals(id,name,role) VALUES($1,$2,$3) ON CONFLICT DO NOTHING',p['id'],p['name'],p['role'])
        for id,domain in [('politica-remoto','publico'),('aquisicao','financeiro')]:
            new=await self.db.fetchval('INSERT INTO sources VALUES($1,$2) ON CONFLICT DO NOTHING RETURNING id',id,domain)
            if new:
                roles=['analyst','finance','board'] if domain=='publico' else ['finance','board']
                await self.db.execute('INSERT INTO grants SELECT id,$1 FROM principals WHERE role=ANY($2::text[])',id,roles)
        self.http=aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=30))
        async with self.http.get(self.c['issuer']+'/.well-known/openid-configuration') as r:metadata=await r.json()
        if metadata['issuer']!=self.c['issuer'] or not metadata['jwks_uri'].startswith(self.c['issuer']+'/'):raise ValueError('untrusted issuer')
        async with self.http.get(metadata['jwks_uri']) as r:jwks=await r.json()
        self.keys={k['kid']:jwt.PyJWK.from_dict(k).key for k in jwks['keys'] if k.get('use')=='sig'}
        self.driver=Neo4jDriver(self.c['neo_uri'],'neo4j',self.c['neo_password'])
        self.graph=Graphiti(graph_driver=self.driver,llm_client=GraphitiCodex(self.c),embedder=OnnxEmbedder(self.c,self.http),
                           cross_encoder=UnusedCrossEncoder(),max_coroutines=1)
        # Neo4jDriver already schedules index creation; do not start a concurrent duplicate build.
        if self.driver._init_task is not None:await self.driver._init_task
    async def actor(self,req):
        try:
            token=req.headers.get('authorization','').removeprefix('Bearer ');header=jwt.get_unverified_header(token)
            if header.get('jku') or header.get('x5u'):raise ValueError('caller key URL')
            claims=jwt.decode(token,self.keys[header['kid']],algorithms=['RS256'],audience='brain-api',issuer=self.c['issuer'],options={'require':['exp','iat','sub','jti']})
        except Exception:raise web.HTTPUnauthorized(text='invalid identity')
        actor=await self.db.fetchrow('SELECT * FROM principals WHERE id=$1 AND enabled',claims['sub'])
        if not actor:raise web.HTTPForbidden(text='principal disabled')
        return dict(actor)
    async def editorial(self,actor,p):
        config={'db':self.c['editorial_db'],'vault':self.c['vault'],'key':self.c['editorial_key'],'installation':self.c['installation'],'actor':actor}
        import subprocess
        proc=await asyncio.to_thread(subprocess.run,['node',str(Path(__file__).parent/'editorial.ts')],
            input=json.dumps({'config':config,'payload':p}),capture_output=True,text=True,encoding='utf-8',timeout=15)
        if proc.returncode:raise web.HTTPConflict(text=proc.stderr[-1200:])
        return json.loads(proc.stdout)
    async def allowed(self,actor,domain):
        if domain not in ('publico','financeiro'):raise PermissionError('unknown domain')
        rows=await self.db.fetch('SELECT s.id,EXISTS(SELECT 1 FROM grants g WHERE g.source=s.id AND g.principal=$1) AS allowed FROM sources s WHERE domain=$2',actor['id'],domain)
        if not rows or any(not r['allowed'] for r in rows):raise PermissionError('entire mixed temporal partition fenced by source grants')
        if await self.db.fetchval("SELECT EXISTS(SELECT 1 FROM publications WHERE domain=$1 AND status!='published')",domain):
            raise web.HTTPServiceUnavailable(text='temporal publication incomplete; reconciliation required')
    def group(self,domain):return 't_'+self.c['installation']+'_'+domain
    async def finish_publication(self,actor,id,receipt):
        fault=Path(self.c['editorial_db']).parent/'fail-editorial-commit-once'
        if fault.exists():
            fault.rename(fault.with_suffix('.consumed'))
            raise web.HTTPServiceUnavailable(text='injected loss before editorial commit; projection remains fenced')
        await self.editorial(actor,{'action':'commit','id':id,'receipt':receipt})
        known=datetime.now(timezone.utc)
        await self.db.execute("UPDATE publications SET status='published',known_at=$1 WHERE draft=$2",known,id)
        return {'published':True,'episode':receipt['episode'],'known_at':known.isoformat(),'edges':receipt['edges']}
    async def dispatch(self,req):
        a=req['actor'];p=await req.json();path=req.path
        if path=='/drafts':
            if set(p)!={'path'}:raise ValueError('editor cannot select authority')
            return await self.editorial(a,{'action':'submit',**p})
        if path=='/review':
            if set(p)!={'id','raw_sha'}:raise ValueError('review contract')
            return await self.editorial(a,{'action':'review',**p})
        if path=='/publish':
            if a['role']!='board':raise PermissionError('governance publication identity required')
            if set(p)!={'id'}:raise ValueError('publication contract')
            async with self.lock:
                previous=await self.db.fetchrow('SELECT * FROM publications WHERE draft=$1',p['id'])
                if previous:
                    if previous['status']=='published':
                        return {'published':True,'episode':previous['episode'],'replayed':True,'known_at':previous['known_at'].isoformat()}
                    if previous['status']=='graph_ready':
                        done=await self.finish_publication(a,p['id'],previous['payload']);done['reconciled_without_reingest']=True;return done
                    raise web.HTTPServiceUnavailable(text='uncertain graph ingestion requires reconciliation; no blind reingest')
                prepared=await self.editorial(a,{'action':'prepare','id':p['id']});payload=prepared['payload']
                sig=hmac.new(bytes.fromhex(self.c['editorial_key']),json.dumps(payload,ensure_ascii=False,separators=(',',':')).encode(),hashlib.sha256).hexdigest()
                if not hmac.compare_digest(sig,prepared['signature']) or payload['installation']!=self.c['installation']:raise PermissionError('editorial receipt invalid')
                if hashlib.sha256(prepared['content'].encode()).hexdigest()!=payload['content_sha']:raise ValueError('approved snapshot integrity')
                await self.db.execute("INSERT INTO publications(draft,source,version,domain,status,payload) VALUES($1,$2,$3,$4,'ingesting',$5)",p['id'],payload['source'],payload['version'],payload['domain'],payload)
                kw={}
                if payload['source']=='politica-remoto':
                    kw={'entity_types':{'Company':Company,'Policy':Policy},'edge_types':{'REMOTE_POLICY':RemotePolicy},
                        'custom_extraction_instructions':'Extraia empresas e políticas e as relações de dias remotos explicitamente informadas. Não crie entidades para datas ou números isolados. Não invente fatos. Preserve datas de vigência e distinção entre retificação retroativa e mudança futura.'}
                result=await self.graph.add_episode(name=payload['source']+'@v'+str(payload['version']),episode_body=prepared['content'],
                    source_description='Fonte canônica aprovada: '+json.dumps(payload,ensure_ascii=False),reference_time=date(payload['valid_at']),
                    source=EpisodeType.text,group_id=self.group(payload['domain']),**kw)
                receipt={'episode':result.episode.uuid,'publication':payload,'edges':[e.model_dump(mode='json') for e in result.edges]}
                await self.db.execute("UPDATE publications SET status='graph_ready',episode=$1,payload=$2 WHERE draft=$3",result.episode.uuid,receipt,p['id'])
                return await self.finish_publication(a,p['id'],receipt)
        if path=='/source-asof':
            if set(p)!={'source','as_of','known_at'}:raise ValueError('canonical as-of contract')
            date(p['as_of']);date(p['known_at'])
            domain=await self.db.fetchval('SELECT domain FROM sources WHERE id=$1',p['source'])
            async with self.lock:
                await self.allowed(a,domain)
                found=await self.editorial(a,{'action':'canonical_asof',**p})
                await self.allowed(a,domain)
                return found
        if path=='/query':
            if set(p)-{'domain','query','as_of','known_at'}:raise ValueError('caller cannot select group ids or permissions')
            domain=p['domain']
            async with self.lock:
                await self.allowed(a,domain)
                asof=date(p['as_of'])
                filters=SearchFilters(valid_at=[[DateFilter(date=asof,comparison_operator=Op.less_than_equal)]],
                    invalid_at=[[DateFilter(comparison_operator=Op.is_null)],[DateFilter(date=asof,comparison_operator=Op.greater_than)]])
                if p.get('known_at'):
                    known=date(p['known_at']);filters.created_at=[[DateFilter(date=known,comparison_operator=Op.less_than_equal)]]
                    filters.expired_at=[[DateFilter(comparison_operator=Op.is_null)],[DateFilter(date=known,comparison_operator=Op.greater_than)]]
                found=await self.graph.search(p['query'],group_ids=[self.group(domain)],num_results=20,search_filter=filters)
                await self.allowed(a,domain)
                return {'facts':[e.model_dump(mode='json') for e in found],'as_of':p['as_of'],'known_at':p.get('known_at')}
        if path=='/admin/graph':
            if a['role']!='board':raise PermissionError('board only')
            records,_,_=await self.driver.execute_query('MATCH ()-[e:RELATES_TO]->() RETURN properties(e) AS edge',routing_='r')
            return {'edges':[dict(r['edge']) for r in records]}
        if path=='/admin/revoke':
            if a['role']!='board':raise PermissionError('board only')
            await self.db.execute('DELETE FROM grants WHERE principal=$1 AND source=$2',p['principal'],p['source'])
            return {'revoked':True}
        raise ValueError('unknown operation')

async def main(c):
    api=API(c);await api.start()
    @web.middleware
    async def guard(req,handler):
        try:
            req['actor']=await api.actor(req);return await handler(req)
        except PermissionError as e:raise web.HTTPForbidden(text=str(e))
        except (KeyError,ValueError) as e:raise web.HTTPConflict(text=str(e))
    async def route(req):return web.json_response(await api.dispatch(req),dumps=lambda v:json.dumps(v,default=str,ensure_ascii=False))
    app=web.Application(middlewares=[guard]);app.router.add_post('/{tail:.*}',route)
    runner=web.AppRunner(app,access_log=None);await runner.setup();site=web.TCPSite(runner,'127.0.0.1',0);await site.start()
    print(json.dumps({'ready':True,'port':site._server.sockets[0].getsockname()[1]}),flush=True)
    await asyncio.Event().wait()

if __name__=='__main__':asyncio.run(main(json.loads(sys.stdin.readline())))
