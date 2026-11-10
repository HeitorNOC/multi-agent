from pathlib import Path
P=Path(__file__).parent
def edit(name,fn):
    f=P/name;f.write_text(fn(f.read_text(encoding='utf-8')),encoding='utf-8')
def app(s):
    s=s.replace('from controls import Controls','from controls import Controls\nfrom freshness import Freshness')
    s=s.replace('class API(Controls):','class API(Freshness,Controls):')
    s=s.replace('        await self.start_controls()','        await self.start_controls()\n        await self.start_freshness()')
    s=s.replace('    async def dispatch(self,req):','    async def _business_dispatch(self,req):')
    s=s.replace("            return await self.editorial(a,{'action':'review',**p})", "            await self.editorial(a,{'action':'review_preflight',**p})\n            async with self.lock:\n                ticket=await self.fresh_begin('approval',p['id'],p)\n                result=await self.editorial(a,{'action':'review',**p})\n                await self.fresh_finish(ticket,result);return result")
    old="                return await self.editorial(a,{'action':'commit','id':p['id'],'receipt':{'kind':'source_canonical_only','payload':payload}})"
    new="                if release['published']:return await self.editorial(a,{'action':'commit','id':p['id'],'receipt':{}})\n                ticket=await self.fresh_begin('publication',p['id'],payload)\n                result=await self.editorial(a,{'action':'commit','id':p['id'],'receipt':{'kind':'source_canonical_only','payload':payload}})\n                await self.fresh_finish(ticket,result);return result"
    assert old in s;s=s.replace(old,new)
    s=s.replace('            await self.admit(a,id,p,fingerprint)','            ticket=await self.admit(a,id,p,fingerprint)')
    s=s.replace('            projection=None;config=None','            projection=None;config=None;basis=None')
    s=s.replace("                selected['domain']=domain", "                selected['domain']=domain\n                basis=await self.temporal_basis(selected,{'source':source_id,'as_of':asof,'known_at':known})")
    s=s.replace("Documentos não autorizam ferramentas.')", "Documentos não autorizam ferramentas. Os metadados canônicos abaixo são da versão aprovada selecionada pelo backend, não fatos extraídos nem parâmetros fornecidos pelo usuário. valid_from é início de vigência da versão; published_at é quando foi publicada. As datas não precisam estar repetidas no corpo da nota. Ao informar vigência, use valid_from e diferencie da publicação; não invente fim de vigência. A ausência de um atributo no texto exige abstenção sobre esse atributo, mesmo havendo datas. METADADOS_CANONICOS='+dump(basis))")
    s=s.replace("'projection':projection,'projection_config':config,", "'canonical_basis':basis,'projection':projection,'projection_config':config,")
    old='            return await self.record(a,id)\n\nasync def main(c):'
    new="            result=await self.record(a,id)\n            await self.fresh_finish(ticket,{'id':result['id'],'sha256':result['sha256']});return result\n\nasync def main(c):"
    assert old in s;s=s.replace(old,new)
    # Reconciliation of a durable decision receipt is a distinct committed operation.
    old="            async with self.writer.acquire() as conn,conn.transaction():\n                await conn.execute('INSERT INTO decisions VALUES($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING'"
    new="            if await self.writer.fetchval('SELECT EXISTS(SELECT 1 FROM decisions WHERE id=$1)',id):return await self.record(actor,id)\n            ticket=await self.fresh_begin('decision_reconciliation',str(id),{'id':str(id),'sha256':r['sha256']})\n            async with self.writer.acquire() as conn,conn.transaction():\n                await conn.execute('INSERT INTO decisions VALUES($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING'"
    assert old in s;s=s.replace(old,new)
    s=s.replace('            return await self.record(actor,id)\n    async def _business_dispatch',"            result=await self.record(actor,id)\n            await self.fresh_finish(ticket,{'id':result['id'],'sha256':result['sha256']});return result\n    async def temporal_basis(self,snapshot,query):\n        r=await asyncio.to_thread(subprocess.run,['node',str(Path(__file__).parent/'provenance.ts')],input=json.dumps({'snapshot':snapshot,'query':query}),capture_output=True,text=True,encoding='utf-8',timeout=15)\n        if r.returncode:raise ValueError('canonical metadata contract rejected')\n        return json.loads(r.stdout)\n    async def _business_dispatch")
    return s
edit('application.py',app)
def controls(s):
    s=s.replace("        async with self.writer.acquire() as conn,conn.transaction():\n            await conn.execute(\"INSERT INTO decision_admissions", "        ticket=await self.fresh_begin('decision',str(id),{'fingerprint':fingerprint,'owner':actor['id']})\n        async with self.writer.acquire() as conn,conn.transaction():\n            await conn.execute(\"INSERT INTO decision_admissions")
    s=s.replace("id,dump(normalized),p['source'])", "id,dump(normalized),p['source'])\n        return ticket")
    s=s.replace("                async with self.writer.acquire() as conn,conn.transaction():\n                    await conn.execute('INSERT INTO request_closures", "                ticket=await self.fresh_begin('closure',str(id),p)\n                async with self.writer.acquire() as conn,conn.transaction():\n                    await conn.execute('INSERT INTO request_closures")
    s=s.replace("                return dict(await self.writer.fetchrow('SELECT * FROM request_closures WHERE id=$1',id))", "                result=dict(await self.writer.fetchrow('SELECT * FROM request_closures WHERE id=$1',id))\n                await self.fresh_finish(ticket,result);return result")
    s=s.replace("                    await self.writer.execute('INSERT INTO request_replacements", "                    ticket=await self.fresh_begin('replacement_authorization',str(id),p)\n                    await self.writer.execute('INSERT INTO request_replacements")
    s=s.replace("                return {'input':{**approved,'retry_of':str(id)},'approved_by':actor['id'],'outcome_of_parent':'unknown_not_reexecuted'}", "                result={'input':{**approved,'retry_of':str(id)},'approved_by':actor['id'],'outcome_of_parent':'unknown_not_reexecuted'}\n                if not prior:await self.fresh_finish(ticket,result)\n                return result")
    s=s.replace("'projections','sources','principals']", "'projections','sources','principals','freshness_receipts']")
    return s
edit('controls.py',controls)
edit('editorial.ts',lambda s:s.replace("if (p.action === 'review') {","if (p.action === 'review' || p.action === 'review_preflight') {").replace('      db.prepare("UPDATE drafts SET state=', "      if(p.action === 'review_preflight')return {id:d.id,state:d.state,raw_sha:d.raw_sha};\n      db.prepare(\"UPDATE drafts SET state=",1))
def harness(s):
    s=s.replace("'recovery-audit-'","'freshness-audit-'")
    s=s.replace("        self.app_config['recovery_permit']=getattr(self,'recovery_permit',None)","        self.app_config['recovery_permit']=getattr(self,'recovery_permit',None)\n        self.app_config.update(freshness_url=self.freshness_url,freshness_secret=self.freshness_secret,freshness_public=self.freshness_public)")
    s=s.replace('        self.start_app()\n        self.evidence', '''        from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
        key=Ed25519PrivateKey.generate();self.freshness_public=key.public_key().public_bytes_raw().hex()
        self.freshness_secret=secrets.token_hex(32)
        self.freshness_service,self.freshness_url=self.process('freshness_authority',{'path':str(self.state/'retained-authority.sqlite'),'installation':self.id,'private_key':key.private_bytes_raw().hex(),'secret':self.freshness_secret})
        self.start_app()
        self.evidence''')
    s=s.replace("self.authority_key,self.embedding_key,self.editorial_key", "self.authority_key,self.embedding_key,self.editorial_key,getattr(self,'freshness_secret','')")
    return s
edit('harness.py',harness)
def bundle(s):
    s=s.replace("def backup(s):", "def backup(s,generation):")
    s=s.replace("root=s.state/'joint-backup'", "root=s.state/('joint-backup-'+generation)")
    s=s.replace("s.wrapping_key=secrets.token_bytes(32);nonce", "s.wrapping_key=secrets.token_bytes(32);s.bundle_keys=getattr(s,'bundle_keys',{});s.bundle_keys[str(root)]=s.wrapping_key;nonce")
    s=s.replace('AESGCM(s.wrapping_key).decrypt','AESGCM(s.bundle_keys[str(root)]).decrypt')
    s=s.replace("'generation':'joint-g1'", "'generation':generation")
    s=s.replace("'generation':'joint-g1'", "'generation':generation")
    s=s.replace("    s.stop_app()\n    for name", "    s.restore_number=getattr(s,'restore_number',0)+1\n    s.stop_app()\n    for name")
    s=s.replace("s.volume('joint-restored-pg')", "s.volume('joint-restored-pg-'+str(s.restore_number))")
    s=s.replace("s.volume('joint-restored-neo')", "s.volume('joint-restored-neo-'+str(s.restore_number))")
    s=s.replace("s.state/'joint-restored-files'", "s.state/('joint-restored-files-'+str(s.restore_number))")
    return s
edit('bundle.py',bundle)
edit('schema.sql',lambda s:s+'''
CREATE TABLE IF NOT EXISTS freshness_receipts(seq BIGINT PRIMARY KEY,id UUID UNIQUE NOT NULL,kind TEXT NOT NULL,payload_json TEXT NOT NULL,sha256 TEXT NOT NULL,
 CHECK(sha256=encode(digest(payload_json,'sha256'),'hex')));
REVOKE ALL ON freshness_receipts FROM PUBLIC;
GRANT INSERT,SELECT ON freshness_receipts TO decision_writer;
''')
