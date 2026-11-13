"""Single-installation PG exclusion; conservative reconciliation, not a workflow owner."""
import asyncio,hashlib,json,time,uuid
from datetime import datetime,timezone
import asyncpg
from aiohttp import web
from freshness_authority import dump,sha

class Coordination:
    async def start_freshness(self):
        conn=await asyncpg.connect(self.c['dsn'])
        key=int.from_bytes(hashlib.sha256((self.c['installation']+':business').encode()).digest()[:8],'big',signed=True)
        try:
            await conn.execute('SELECT pg_advisory_lock($1)',key)
            await super().start_freshness()
        finally:await conn.close()
    async def dispatch(self,req):
        actor=req['actor'];path=req.path
        if path in ('/freshness/status','/recovery/status'):
            self.recovering=bool(await self.db.fetchval('SELECT recovering FROM recovery_control WHERE id'))
            return await super().dispatch(req)
        lock_key=int.from_bytes(hashlib.sha256((self.c['installation']+(':security' if path=='/admin/revoke' else ':business')).encode()).digest()[:8],'big',signed=True)
        conn=await asyncpg.connect(self.c['dsn'])
        try:
            queued=time.perf_counter()
            deadline=time.monotonic()+180
            while not await conn.fetchval('SELECT pg_try_advisory_lock($1)',lock_key):
                if time.monotonic()>deadline:raise web.HTTPServiceUnavailable(text='installation busy; no admission retry yet')
                await asyncio.sleep(.05)
            req['queue_seconds']=time.perf_counter()-queued
            self.recovering=bool(await self.db.fetchval('SELECT recovering FROM recovery_control WHERE id'))
            if await self.db.fetchval('SELECT frozen FROM backup_control WHERE id') and path not in ('/recovery/freeze','/recovery/thaw','/recovery/open'):
                raise web.HTTPServiceUnavailable(text='installation frozen for coordinated backup')
            if path.startswith('/freshness/') and path!='/freshness/status':
                return await self.resolve_intent(actor,path,await req.json())
            if path not in ('/admin/revoke','/recovery/open'):
                status=await self.freshness_status()
                if not status['matches']:
                    await self.db.execute('UPDATE recovery_control SET recovering=TRUE');self.recovering=True
            return await super().dispatch(req)
        finally:await conn.close() # session lock released, including on process termination
    async def pending_operation(self,seq):
        proof=await self.authority_request(action='proof')
        remote=next((r for r in proof['operations'] if r['seq']==seq),None)
        if not remote:raise ValueError('operation missing')
        return remote,sha(remote)
    async def reopen_if_complete(self):
        status=await self.freshness_status()
        if status['matches'] and not await self.db.fetchval('SELECT joint_restore FROM recovery_control WHERE id'):
            await self.db.execute('UPDATE recovery_control SET recovering=FALSE');self.recovering=False
        return {'matches':status['matches'],'recovering':bool(await self.db.fetchval('SELECT recovering FROM recovery_control WHERE id'))}
    async def audit_resolution(self,actor,seq,action,evidence):
        await self.writer.execute('INSERT INTO reconciliation_audit VALUES($1,$2,$3,$4,$5,$6)',uuid.uuid4(),seq,actor['id'],action,evidence,datetime.now(timezone.utc).isoformat())
    async def resolve_intent(self,actor,path,p):
        if actor['role']!='board':raise PermissionError('governance required')
        if path=='/freshness/budget':return (await self.authority_request(action='proof'))['budgets']
        seq=int(p['seq']);remote,evidence=await self.pending_operation(seq);context=remote['context']
        if remote['kind']!='decision':raise ValueError('only decision reconciliation qualified here')
        await self.allowed(actor,context['source'])
        request_id=uuid.UUID(context['request_id']);op_id=uuid.UUID(remote['id'])
        local=await self.writer.fetchrow('SELECT * FROM freshness_receipts WHERE seq=$1',seq)
        if path=='/freshness/inspect':return {'operation':remote,'evidence_sha':evidence,'local_receipt':bool(local)}
        if path=='/freshness/reconcile':
            if set(p)!={'seq'}:raise ValueError('reconcile contract')
            if not local:
                # Read an immutable durable business receipt, never regenerate inference.
                r=await self.writer.fetchrow('SELECT * FROM decision_receipts WHERE id=$1',request_id)
                if not r:raise web.HTTPServiceUnavailable(text='no durable decision receipt; outcome unknown')
                owner=await self.db.fetchrow('SELECT * FROM principals WHERE id=$1 AND enabled',r['owner'])
                if not owner or r['owner']!=context['owner']:raise PermissionError('owner missing/changed')
                await self.allowed(owner,r['source'])
                if hashlib.sha256(r['record_json'].encode()).hexdigest()!=r['sha256']:raise ValueError('business receipt integrity')
                admission=await self.writer.fetchrow('SELECT * FROM decision_admissions WHERE id=$1',request_id)
                if not admission or admission['fingerprint']!=context['fingerprint']:raise ValueError('admission differs from authority')
                text=dump({'id':str(request_id),'sha256':r['sha256']});digest=hashlib.sha256(text.encode()).hexdigest()
                async with self.writer.acquire() as conn,conn.transaction():
                    await conn.execute('INSERT INTO decisions VALUES($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING',request_id,r['owner'],r['source'],r['record_json'],r['sha256'])
                    await conn.execute("UPDATE decision_admissions SET status='completed' WHERE id=$1",request_id)
                    await conn.execute('INSERT INTO freshness_receipts VALUES($1,$2,$3,$4,$5)',seq,op_id,'decision',text,digest)
                local=await self.writer.fetchrow('SELECT * FROM freshness_receipts WHERE seq=$1',seq)
            payload=json.loads(local['payload_json'])
            if local['id']!=op_id or hashlib.sha256(local['payload_json'].encode()).hexdigest()!=local['sha256']:raise ValueError('local freshness receipt integrity')
            if payload.get('kind')=='closed_unknown_intent':
                await self.authority_request(action='resolve_unknown',id=str(op_id),receipt_sha=local['sha256'],approvers=[payload['prepared_by'],payload['confirmed_by']])
            else:
                record=await self.record(actor,request_id)
                owner=await self.db.fetchrow('SELECT * FROM principals WHERE id=$1 AND enabled',context['owner'])
                if not owner:raise PermissionError('original owner disabled')
                await self.allowed(owner,context['source'])
                if payload!={'id':str(request_id),'sha256':record['sha256']}:raise ValueError('decision differs from freshness receipt')
                await self.authority_request(action='complete',id=str(op_id),receipt_sha=local['sha256'])
            await self.audit_resolution(actor,seq,'reconcile',evidence)
            return await self.reopen_if_complete()
        if remote['receipt_sha'] is not None:
            proposal=await self.writer.fetchrow('SELECT * FROM intent_proposals WHERE seq=$1',seq)
            payload=json.loads(local['payload_json']) if local else {}
            if path=='/freshness/close-confirm' and set(p)=={'seq','evidence_sha'} and proposal and p['evidence_sha']==proposal['evidence_sha'] and payload.get('kind')=='closed_unknown_intent' and payload['confirmed_by']==actor['id']:
                return {'outcome':payload,**await self.reopen_if_complete()}
            raise ValueError('operation already resolved')
        if local or await self.writer.fetchval('SELECT EXISTS(SELECT 1 FROM decision_receipts WHERE id=$1)',request_id):raise ValueError('durable receipt requires reconciliation, not unknown closure')
        if actor['id']==context['owner']:raise PermissionError('owner cannot resolve own unknown operation')
        if path=='/freshness/close-prepare':
            if set(p)!={'seq','reason','evidence_sha'} or not isinstance(p['reason'],str) or not 20<=len(p['reason'])<=500 or p['evidence_sha']!=evidence:raise ValueError('current evidence and reason required')
            old=await self.writer.fetchrow('SELECT * FROM intent_proposals WHERE seq=$1',seq)
            if old:
                if old['prepared_by']!=actor['id'] or old['reason']!=p['reason'] or old['evidence_sha']!=evidence:raise ValueError('proposal immutable')
            else:await self.writer.execute('INSERT INTO intent_proposals VALUES($1,$2,$3,$4,$5)',seq,op_id,evidence,p['reason'],actor['id'])
            return {'seq':seq,'prepared_by':actor['id'],'evidence_sha':evidence}
        if path=='/freshness/close-confirm':
            if set(p)!={'seq','evidence_sha'} or p['evidence_sha']!=evidence:raise ValueError('current evidence required')
            proposal=await self.writer.fetchrow('SELECT * FROM intent_proposals WHERE seq=$1',seq)
            if not proposal or proposal['prepared_by']==actor['id']:raise PermissionError('second governance identity required')
            first=await self.db.fetchrow("SELECT * FROM principals WHERE id=$1 AND enabled AND role='board'",proposal['prepared_by'])
            if not first:raise PermissionError('first governance identity disabled')
            await self.allowed(first,context['source'])
            if proposal['evidence_sha']!=evidence:raise ValueError('evidence changed')
            outcome={'kind':'closed_unknown_intent','seq':seq,'operation_id':str(op_id),'request_id':str(request_id),'reason':proposal['reason'],'prepared_by':first['id'],'confirmed_by':actor['id'],'original_outcome':'unknown_not_reexecuted'}
            text=dump(outcome);digest=hashlib.sha256(text.encode()).hexdigest()
            async with self.writer.acquire() as conn,conn.transaction():
                await conn.execute('INSERT INTO intent_tombstones VALUES($1,$2,$3,$4,$5,$6,$7,$8)',request_id,context['owner'],context['source'],context['fingerprint'],seq,proposal['reason'],first['id'],actor['id'])
                await conn.execute('INSERT INTO freshness_receipts VALUES($1,$2,$3,$4,$5)',seq,op_id,'decision',text,digest)
            await self.authority_request(action='resolve_unknown',id=str(op_id),receipt_sha=digest,approvers=[first['id'],actor['id']])
            await self.audit_resolution(actor,seq,'close_unknown',evidence)
            return {'outcome':outcome,**await self.reopen_if_complete()}
        raise ValueError('unknown intent operation')
