"""Coordinated cold backup gate and retained quota floors. Bancada only."""
import hashlib,hmac,json,uuid
import asyncpg
from aiohttp import web
from controls import sign

FORMAT='restore-state-v1'

def validate_budget_floors(current,expected):
    for scope,floor in expected.items():
        actual=current.get(scope)
        if not actual or actual['cap']!=floor['cap'] or actual['reserved']<floor['reserved']:
            raise ValueError('retained quota below signed backup floor or cap changed: '+scope)

class Maintenance:
    async def recovery(self,actor,path,p):
        if actor['role']!='board':raise PermissionError('governance required')
        if path=='/recovery/freeze':
            if p or self.recovering or await self.db.fetchval('SELECT joint_restore FROM recovery_control WHERE id'):raise ValueError('cannot snapshot unresolved joint recovery')
            if await self.db.fetchval('SELECT revision FROM format_control WHERE id')!=FORMAT:raise ValueError('unsupported database revision')
            # Coordination already holds the business lock; drain the separate revocation lock too.
            conn=await asyncpg.connect(self.c['dsn'])
            key=int.from_bytes(hashlib.sha256((self.c['installation']+':security').encode()).digest()[:8],'big',signed=True)
            try:
                await conn.execute('SELECT pg_advisory_lock($1)',key)
                await self.freshness_require()
                old=await self.db.fetchrow('SELECT * FROM backup_control WHERE id')
                token=old['token'] if old['frozen'] else uuid.uuid4()
                await self.db.execute('UPDATE backup_control SET frozen=TRUE,token=$1 WHERE id',token)
                inventory=await self.inventory();proof=await self.authority_request(action='proof')
                return {'token':str(token),'inventory':inventory,'budget_floors':proof['budgets'],'authority_head':proof['head'],'authority_seq':proof['seq'],'format':FORMAT}
            finally:await conn.close()
        if path=='/recovery/thaw':
            if set(p)!={'token'} or self.recovering or await self.db.fetchval('SELECT joint_restore FROM recovery_control WHERE id'):raise ValueError('thaw is not a restore override')
            token=await self.db.fetchval('SELECT token FROM backup_control WHERE id')
            if str(token)!=p['token']:raise ValueError('freeze token mismatch')
            await self.db.execute('UPDATE backup_control SET frozen=FALSE WHERE id')
            return {'thawed':True}
        if path=='/recovery/open':
            permit=self.c.get('recovery_permit')
            if not permit or not hmac.compare_digest(sign(self.c['journal_key'],permit['payload']),permit['signature']):raise ValueError('trusted restore permit required')
            if permit['payload'].get('format')!=FORMAT:raise ValueError('unsupported restore format')
            proof=await self.authority_request(action='proof');validate_budget_floors(proof['budgets'],permit['payload']['budget_floors'])
            result=await super().recovery(actor,path,p)
            await self.db.execute('UPDATE backup_control SET frozen=FALSE WHERE id')
            return {**result,'retained_budgets':proof['budgets']}
        return await super().recovery(actor,path,p)
