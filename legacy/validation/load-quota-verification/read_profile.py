"""Experimental historical-read profile; never runs a workflow or generates a new answer."""
import hashlib,time,uuid
import asyncpg
from aiohttp import web

class ReadProfile:
    async def dispatch(self,req):
        if not self.c.get('parallel_history') or req.method!='GET' or not req.path.startswith('/decisions/'):
            return await super().dispatch(req)
        queued=time.perf_counter();conn=await asyncpg.connect(self.c['dsn'])
        key=int.from_bytes(hashlib.sha256((self.c['installation']+':business').encode()).digest()[:8],'big',signed=True)
        try:
            # With no exclusive writer, a shared lock lets us inspect the retained head before reading.
            shared=await conn.fetchval('SELECT pg_try_advisory_lock_shared($1)',key)
            req['queue_seconds']=time.perf_counter()-queued
            await self.read_gate()
            if shared:
                status=await self.freshness_status()
                if not status['matches']:
                    await self.db.execute('UPDATE recovery_control SET recovering=TRUE')
                    raise web.HTTPServiceUnavailable(text='pending or stale recovery; historical read fenced')
            # An existing exclusive writer may have an intentional pending inference.
            # Only immutable original advice is read; current owner/source grants are checked by record().
            result=await self.record(req['actor'],uuid.UUID(req.match_info['id']))
            await self.read_gate()
            return result
        finally:await conn.close()
    async def read_gate(self):
        if await self.db.fetchval('SELECT recovering OR joint_restore FROM recovery_control WHERE id') or await self.db.fetchval('SELECT frozen FROM backup_control WHERE id'):
            raise web.HTTPServiceUnavailable(text='recovery or coordinated backup fenced')
