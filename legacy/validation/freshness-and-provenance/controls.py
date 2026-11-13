"""Own-layer governance/recovery controls. Single-process qualification only."""
import asyncio,hashlib,hmac,json,os,sqlite3,uuid
import asyncpg
from datetime import datetime,timezone
from pathlib import Path
from aiohttp import web
from neo4j import AsyncGraphDatabase

def dump(v):return json.dumps(v,sort_keys=True,ensure_ascii=False,separators=(',',':'),default=str)
def sha(v):return hashlib.sha256(v.encode()).hexdigest()
def sign(key,value):return hmac.new(bytes.fromhex(key),dump(value).encode(),hashlib.sha256).hexdigest()

class Controls:
    async def start_controls(self):
        self.recovering=bool(await self.db.fetchval('SELECT recovering FROM recovery_control WHERE id'))
        if self.c.get('restoring'):
            await self.db.execute('UPDATE recovery_control SET recovering=TRUE');self.recovering=True
        await self.replay_revocations()
    def read_journal(self):
        p=Path(self.c['security_journal']);anchor=Path(self.c['journal_anchor']);events=[];previous=''
        if not p.exists() and not anchor.exists():return []
        if not p.exists() or not anchor.exists():raise ValueError('journal/anchor missing; fenced')
        for line in p.read_text(encoding='utf-8').splitlines():
            row=json.loads(line);payload=row['payload']
            if payload['seq']!=len(events)+1 or payload['previous']!=previous or not hmac.compare_digest(sign(self.c['journal_key'],payload),row['signature']):raise ValueError('journal integrity; fenced')
            previous=sha(dump(row));events.append(payload)
        a=json.loads(anchor.read_text(encoding='utf-8'));body={'seq':len(events),'head':previous}
        if a['payload']!=body or not hmac.compare_digest(sign(self.c['journal_key'],body),a['signature']):raise ValueError('journal anchor mismatch; fenced')
        return events
    async def replay_revocations(self):
        for e in self.read_journal():
            if e['kind']!='revoke':raise ValueError('unsupported security event')
            await self.db.execute('DELETE FROM grants WHERE principal=$1 AND source=$2',e['principal'],e['source'])
    async def revoke(self,p):
        if set(p)!={'principal','source'}:raise ValueError('revocation contract')
        events=self.read_journal();path=Path(self.c['security_journal']);anchor=Path(self.c['journal_anchor'])
        previous=json.loads(anchor.read_text(encoding='utf-8'))['payload']['head'] if events else ''
        payload={'seq':len(events)+1,'previous':previous,'kind':'revoke','principal':p['principal'],'source':p['source']}
        row={'payload':payload,'signature':sign(self.c['journal_key'],payload)}
        # Fail closed in this process if either durable write fails. Journal/anchor mismatch blocks restart.
        self.recovering=True
        with path.open('a',encoding='utf-8') as f:f.write(dump(row)+'\n');f.flush();os.fsync(f.fileno())
        body={'seq':payload['seq'],'head':sha(dump(row))}
        temp=anchor.with_suffix('.tmp')
        with temp.open('w',encoding='utf-8') as f:f.write(dump({'payload':body,'signature':sign(self.c['journal_key'],body)}));f.flush();os.fsync(f.fileno())
        temp.replace(anchor)
        await self.replay_revocations();self.recovering=bool(await self.db.fetchval('SELECT recovering FROM recovery_control WHERE id'))
    async def admit(self,actor,id,p,fingerprint):
        normalized={k:v for k,v in p.items() if k!='retry_of'}
        if p.get('retry_of'):
            parent=uuid.UUID(p['retry_of']);r=await self.writer.fetchrow('SELECT * FROM request_replacements WHERE parent=$1 AND id=$2',parent,id)
            if not r or r['owner']!=actor['id']:raise PermissionError('replacement authorization required for owner')
            if r['input_json']!=dump(normalized):raise ValueError('replacement input differs from approval')
        elif await self.writer.fetchval("SELECT EXISTS(SELECT 1 FROM decision_admissions WHERE owner=$1 AND fingerprint=$2 AND status='closed_unknown')",actor['id'],fingerprint):
            raise ValueError('same closed request requires controlled replacement')
        ticket=await self.fresh_begin('decision',str(id),{'fingerprint':fingerprint,'owner':actor['id']})
        async with self.writer.acquire() as conn,conn.transaction():
            await conn.execute("INSERT INTO decision_admissions VALUES($1,$2,$3,'running')",id,actor['id'],fingerprint)
            await conn.execute('INSERT INTO request_context VALUES($1,$2,$3)',id,dump(normalized),p['source'])
        return ticket
    async def pending_evidence(self,id):
        r=await self.writer.fetchrow('SELECT a.*,c.input_json,c.source FROM decision_admissions a JOIN request_context c USING(id) WHERE a.id=$1',id)
        if not r:raise web.HTTPNotFound(text='admission missing')
        receipt=await self.writer.fetchval('SELECT EXISTS(SELECT 1 FROM decision_receipts WHERE id=$1)',id)
        body={**dict(r),'receipt_exists':receipt};return body,sha(dump(body))
    async def pending(self,actor,path,p):
        if actor['role']!='board':raise PermissionError('governance required')
        async with self.lock:
            id=uuid.UUID(p['request_id']);body,evidence=await self.pending_evidence(id);await self.allowed(actor,body['source'])
            if path=='/pending/inspect':
                if set(p)!={'request_id'}:raise ValueError('inspect contract')
                return {'admission':body,'evidence_sha':evidence}
            if path=='/pending/close':
                if set(p)!={'request_id','reason','evidence_sha'} or not isinstance(p['reason'],str) or not 20<=len(p['reason'])<=500:raise ValueError('closure contract/reason')
                if actor['id']==body['owner']:raise PermissionError('owner cannot close own request')
                prior=await self.writer.fetchrow('SELECT * FROM request_closures WHERE id=$1',id)
                if prior:
                    if prior['closer']!=actor['id'] or prior['reason']!=p['reason'] or prior['evidence_sha']!=p['evidence_sha']:raise ValueError('closure is immutable')
                    return dict(prior)
                if body['status']!='running' or body['receipt_exists'] or not hmac.compare_digest(evidence,p['evidence_sha']):raise ValueError('closure needs current pending evidence without receipt')
                ticket=await self.fresh_begin('closure',str(id),p)
                async with self.writer.acquire() as conn,conn.transaction():
                    await conn.execute('INSERT INTO request_closures VALUES($1,$2,$3,$4,$5)',id,actor['id'],p['reason'],evidence,datetime.now(timezone.utc).isoformat())
                    await conn.execute("UPDATE decision_admissions SET status='closed_unknown' WHERE id=$1",id)
                result=dict(await self.writer.fetchrow('SELECT * FROM request_closures WHERE id=$1',id))
                await self.fresh_finish(ticket,result);return result
            if path=='/pending/authorize':
                if set(p)!={'request_id','new_id'}:raise ValueError('replacement authorization contract')
                closure=await self.writer.fetchrow('SELECT * FROM request_closures WHERE id=$1',id)
                if not closure or closure['closer']==actor['id']:raise PermissionError('second governance identity required')
                owner=await self.db.fetchrow('SELECT * FROM principals WHERE id=$1 AND enabled',body['owner'])
                if not owner:raise PermissionError('original owner disabled')
                await self.allowed(owner,body['source']);new_id=uuid.UUID(p['new_id'])
                if new_id==id:raise ValueError('new request ID required')
                approved={**json.loads(body['input_json']),'request_id':str(new_id)}
                prior=await self.writer.fetchrow('SELECT * FROM request_replacements WHERE parent=$1',id)
                if prior:
                    if prior['id']!=new_id or prior['approver']!=actor['id']:raise ValueError('replacement is immutable')
                else:
                    if await self.writer.fetchval('SELECT EXISTS(SELECT 1 FROM decision_admissions WHERE id=$1)',new_id):raise ValueError('replacement ID already used')
                    ticket=await self.fresh_begin('replacement_authorization',str(id),p)
                    await self.writer.execute('INSERT INTO request_replacements VALUES($1,$2,$3,$4,$5)',id,new_id,body['owner'],dump(approved),actor['id'])
                result={'input':{**approved,'retry_of':str(id)},'approved_by':actor['id'],'outcome_of_parent':'unknown_not_reexecuted'}
                if not prior:await self.fresh_finish(ticket,result)
                return result
            raise ValueError('unknown pending operation')
    async def inventory(self):
        tables={}
        for table in ['decisions','decision_receipts','decision_admissions','request_context','request_closures','request_replacements','projections','sources','principals','freshness_receipts']:
            rows=[dict(r) for r in await self.db.fetch('SELECT * FROM '+table)]
            tables[table]=sha(dump(sorted([dump(r) for r in rows])))
        def editorial():
            with sqlite3.connect('file:'+self.c['editorial_db']+'?mode=ro',uri=True) as db:return sha('\n'.join(db.iterdump()))
        editorial_sha=await asyncio.to_thread(editorial)
        driver=AsyncGraphDatabase.driver(os.environ['NEO4J_URI'],auth=(os.environ['NEO4J_USERNAME'],os.environ['NEO4J_PASSWORD']))
        try:
            async with driver.session() as sess:
                nodes=await (await sess.run('MATCH (n) RETURN labels(n) AS labels, properties(n) AS props')).data()
                edges=await (await sess.run('MATCH (a)-[r]->(b) RETURN properties(a) AS a, type(r) AS type, properties(r) AS props, properties(b) AS b')).data()
        finally:await driver.close()
        knowledge={}
        conn=await asyncpg.connect(host=os.environ['POSTGRES_HOST'],port=int(os.environ['POSTGRES_PORT']),user=os.environ['POSTGRES_USER'],password=os.environ['POSTGRES_PASSWORD'],database=os.environ['POSTGRES_DATABASE'])
        try:
            for t in await conn.fetch("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename"):
                quoted='"'+t['tablename'].replace('"','""')+'"'
                rows=await conn.fetch('SELECT row_to_json(t)::text AS row FROM '+quoted+' t')
                knowledge[t['tablename']]={'rows':len(rows),'sha256':sha(dump(sorted(r['row'] for r in rows)))}
        finally:await conn.close()
        grants=sorted([list(r.values()) for r in await self.db.fetch('SELECT principal,source FROM grants')])
        return {'tables':tables,'knowledge':knowledge,'grants':grants,'editorial':editorial_sha,'neo4j':sha(dump({'nodes':sorted(dump(r) for r in nodes),'edges':sorted(dump(r) for r in edges)})),
                'neo4j_nodes':len(nodes),'neo4j_edges':len(edges)}
    async def recovery(self,actor,path,p):
        if actor['role']!='board':raise PermissionError('governance required')
        if path=='/recovery/status':return {'recovering':self.recovering,'journal_events':len(self.read_journal())}
        if path=='/recovery/inventory':
            if self.recovering:raise web.HTTPServiceUnavailable(text='joint recovery fenced')
            return await self.inventory()
        if path=='/recovery/open':
            if p:raise ValueError('caller cannot choose recovery authority')
            permit=self.c.get('recovery_permit')
            if not permit or not hmac.compare_digest(sign(self.c['journal_key'],permit['payload']),permit['signature']):raise ValueError('trusted recovery permit required')
            if permit['payload']['installation']!=self.c['installation']:raise ValueError('permit installation mismatch')
            await self.replay_revocations()
            actual=await self.inventory();expected=json.loads(dump(permit['payload']['inventory']))
            for event in self.read_journal():
                pair=[event['principal'],event['source']]
                expected['grants']=[g for g in expected['grants'] if g!=pair]
            if actual!=expected:raise ValueError('joint inventory mismatch; fenced')
            await self.db.execute('UPDATE recovery_control SET recovering=FALSE');self.recovering=False
            return {'opened':True,'inventory':actual,'journal_events':len(self.read_journal())}
        raise ValueError('unknown recovery operation')
