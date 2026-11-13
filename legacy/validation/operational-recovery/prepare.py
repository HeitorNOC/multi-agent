from pathlib import Path
P=Path(__file__).parent
f=P/'application.py';s=f.read_text(encoding='utf-8')
# The previous prepare.py used the Windows default codec while reading UTF-8.
# Repair only copied string literals here; original evidence remains unchanged.
for old,new in [('vigÃªncia','vigência'),('portuguÃªs','português'),('NÃ£o','Não'),('ausÃªncia','ausência'),('informaÃ§Ã£o','informação'),('nÃ£o','não')]:s=s.replace(old,new)
s=s.replace('from codex_provider import CodexProvider','from codex_provider import CodexProvider\nfrom controls import Controls')
s=s.replace('class API:', 'class API(Controls):')
s=s.replace("        self.keys={k['kid']:jwt.PyJWK.from_dict(k).key for k in jwks['keys'] if k.get('use')=='sig'}", "        self.keys={k['kid']:jwt.PyJWK.from_dict(k).key for k in jwks['keys'] if k.get('use')=='sig'}\n        await self.start_controls()")
s=s.replace("        if not r or not r['allowed']:","        if not r or not r['allowed'] or not await self.db.fetchval('SELECT enabled FROM principals WHERE id=$1',actor['id']):")
s=s.replace("        if path=='/reconcile':", "        if path.startswith('/recovery/'):\n            return await self.recovery(a,path,p)\n        if self.recovering:raise web.HTTPServiceUnavailable(text='joint recovery fenced')\n        if path.startswith('/pending/'):\n            return await self.pending(a,path,p)\n        if path=='/reconcile':")
# GET also needs recovery fence, before record dispatch.
s=s.replace("        if req.method=='GET':return", "        if req.method=='GET' and self.recovering:raise web.HTTPServiceUnavailable(text='joint recovery fenced')\n        if req.method=='GET':return")
s=s.replace("            await self.db.execute('DELETE FROM grants WHERE principal=$1 AND source=$2',p['principal'],p['source']);return {'revoked':True}","            async with self.lock:\n                await self.revoke(p)\n            return {'revoked':True}")
s=s.replace("set(p)!={'request_id','source','question','as_of','known_at'}", "set(p) not in ({'request_id','source','question','as_of','known_at'},{'request_id','source','question','as_of','known_at','retry_of'})")
s=s.replace("                if old['status']!='completed':", "                if old['status']=='closed_unknown':raise ValueError('closed with unknown outcome; controlled replacement required')\n                if old['status']!='completed':")
s=s.replace("            await self.writer.execute(\"INSERT INTO decision_admissions VALUES($1,$2,$3,'running')\",id,a['id'],fingerprint)","            await self.admit(a,id,p,fingerprint)")
s=s.replace("'source':source_id,'question':p['question'],", "'source':source_id,'retry_of':p.get('retry_of'),'question':p['question'],")
f.write_text(s,encoding='utf-8')
f=P/'harness.py';s=f.read_text(encoding='utf-8').replace("'expanded-audit-'","'recovery-audit-'")
s=s.replace("['analista','financeiro','aprovador','executor']","['analista','financeiro','aprovador','auditor','executor']")
s=s.replace("'aprovador':'board','executor':'worker'","'aprovador':'board','auditor':'board','executor':'worker'")
s=s.replace("        Path(self.app_config['vault']).mkdir(exist_ok=True)","        self.app_config.update(getattr(self,'recovered_paths',{}))\n        self.app_config['journal_anchor']=str(self.state/'security-head.json')\n        self.app_config['recovery_permit']=getattr(self,'recovery_permit',None)\n        Path(self.app_config['vault']).mkdir(exist_ok=True)")
f.write_text(s,encoding='utf-8')
f=P/'schema.sql';s=f.read_text(encoding='utf-8');s+='''
CREATE TABLE IF NOT EXISTS request_context(id UUID PRIMARY KEY REFERENCES decision_admissions(id),input_json TEXT NOT NULL,source TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS request_closures(id UUID PRIMARY KEY REFERENCES decision_admissions(id),closer TEXT NOT NULL,reason TEXT NOT NULL,evidence_sha TEXT NOT NULL,closed_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS request_replacements(parent UUID PRIMARY KEY REFERENCES request_closures(id),id UUID UNIQUE NOT NULL,owner TEXT NOT NULL,input_json TEXT NOT NULL,approver TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS recovery_control(id BOOL PRIMARY KEY DEFAULT TRUE CHECK(id),recovering BOOL NOT NULL);
INSERT INTO recovery_control VALUES(TRUE,FALSE) ON CONFLICT DO NOTHING;
REVOKE ALL ON request_context,request_closures,request_replacements FROM PUBLIC;
GRANT INSERT,SELECT ON request_context,request_closures,request_replacements TO decision_writer;
''';f.write_text(s,encoding='utf-8')
