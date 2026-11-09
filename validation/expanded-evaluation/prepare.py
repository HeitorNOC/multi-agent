from pathlib import Path
p=Path(__file__).parent
f=p/'harness.py';s=f.read_text();s=s.replace("'canonical-audit-'","'expanded-audit-'")
s=s.replace("model_name=os.environ.get('AUDIT_MODEL','gpt-6.1-terra'))","model_name=os.environ.get('AUDIT_MODEL','gpt-6.1-terra'),retrieval_mode=os.environ.get('AUDIT_RETRIEVAL','mix'))")
f.write_text(s,encoding='utf-8')
f=p/'codex_provider.py';s=f.read_text().replace(">=28",">=40");f.write_text(s,encoding='utf-8')
f=p/'schema.sql';s=f.read_text();s+='''
CREATE TABLE IF NOT EXISTS decision_receipts(id UUID PRIMARY KEY REFERENCES decision_admissions(id),owner TEXT NOT NULL,source TEXT NOT NULL,
 record_json TEXT NOT NULL,sha256 TEXT NOT NULL,CHECK(sha256=encode(digest(record_json,'sha256'),'hex')));
REVOKE ALL ON decision_receipts FROM PUBLIC;
GRANT INSERT,SELECT ON decision_receipts TO decision_writer;
''';f.write_text(s,encoding='utf-8')
f=p/'application.py';s=f.read_text()
s=s.replace("    async def dispatch(self,req):",'''    async def fault(self,stage):
        # Private harness-only control. No HTTP route or caller-selected fault.
        arm=Path(self.c['state'])/'fault-arm.json'
        if arm.exists() and json.loads(arm.read_text()).get('stage')==stage:
            arm.write_text('{}')
            (Path(self.c['state'])/'fault-reached.json').write_text(json.dumps({'stage':stage}))
            await asyncio.Event().wait()
    async def reconcile(self,actor,id):
        if actor['role']!='board':raise PermissionError('governance required')
        async with self.lock:
            r=await self.writer.fetchrow('SELECT * FROM decision_receipts WHERE id=$1',id)
            if not r:raise web.HTTPServiceUnavailable(text='no durable receipt; outcome uncertain; no blind retry')
            await self.allowed(actor,r['source'])
            owner=await self.db.fetchrow('SELECT * FROM principals WHERE id=$1 AND enabled',r['owner'])
            if not owner:raise PermissionError('original owner disabled')
            await self.allowed(owner,r['source'])
            if sha(r['record_json'])!=r['sha256']:raise ValueError('receipt integrity')
            async with self.writer.acquire() as conn,conn.transaction():
                await conn.execute('INSERT INTO decisions VALUES($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING',id,r['owner'],r['source'],r['record_json'],r['sha256'])
                await conn.execute("UPDATE decision_admissions SET status='completed' WHERE id=$1",id)
            return await self.record(actor,id)
    async def dispatch(self,req):''')
s=s.replace("        if path=='/drafts':","        if path=='/reconcile':\n            if set(p)!={'request_id'}:raise ValueError('reconciliation contract')\n            return await self.reconcile(a,uuid.UUID(p['request_id']))\n        if path=='/drafts':")
s=s.replace("self.c['model_name']]))","self.c['model_name'],self.c['retrieval_mode']]))")
s=s.replace("            budget=Path(self.c['model_budget'])","            await self.fault('after_admission')\n            budget=Path(self.c['model_budget'])")
s=s.replace("QueryParam(mode='mix'","QueryParam(mode=self.c['retrieval_mode']")
s=s.replace("'projection':projection,'projection_config':config,","'projection':projection,'projection_config':config,'retrieval_mode':self.c['retrieval_mode'],")
s=s.replace("            text=dump(payload)\n            async with", "            text=dump(payload)\n            await self.writer.execute('INSERT INTO decision_receipts VALUES($1,$2,$3,$4,$5)',id,a['id'],source_id,text,sha(text))\n            await self.fault('after_receipt')\n            await self.allowed(a,source_id)\n            async with")
f.write_text(s,encoding='utf-8')
