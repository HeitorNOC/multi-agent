from pathlib import Path
P=Path(__file__).parent
def edit(name,fn):
    f=P/name;f.write_text(fn(f.read_text(encoding='utf-8')),encoding='utf-8')
def app(s):
    s=s.replace('from freshness import Freshness','from freshness import Freshness\nfrom coordination import Coordination')
    s=s.replace('class API(Freshness,Controls):','class API(Coordination,Freshness,Controls):')
    s=s.replace("arm.exists() and json.loads(arm.read_text()).get('stage')==stage", "arm.exists() and json.loads(arm.read_text()).get('stage')==stage and json.loads(arm.read_text()).get('instance')==self.c['instance']")
    s=s.replace("budget=Path(self.c['model_budget']);before=json.loads(budget.read_text())['calls'] if budget.exists() else 0", "before=await self.model.count()")
    s=s.replace("(json.loads(budget.read_text())['calls'] if budget.exists() else before)","(await self.model.count())")
    s=s.replace("            await self.editorial(a,{'action':'review_preflight',**p})", "            preflight=await self.editorial(a,{'action':'review_preflight',**p})\n            await self.allowed(a,preflight['source'])")
    s=s.replace("                ticket=await self.fresh_begin('publication',p['id'],payload)","                await self.allowed(a,payload['source'])\n                ticket=await self.fresh_begin('publication',p['id'],payload)\n                await self.allowed(a,payload['source'])")
    return s
edit('application.py',app)
edit('editorial.ts',lambda s:s.replace("return {id:d.id,state:d.state,raw_sha:d.raw_sha};", "return {id:d.id,state:d.state,raw_sha:d.raw_sha,source:d.source};"))
def controls(s):
    s=s.replace("UPDATE recovery_control SET recovering=TRUE", "UPDATE recovery_control SET recovering=TRUE,joint_restore=TRUE")
    s=s.replace("UPDATE recovery_control SET recovering=FALSE", "UPDATE recovery_control SET recovering=FALSE,joint_restore=FALSE")
    s=s.replace("    async def admit(self,actor,id,p,fingerprint):", "    async def admit(self,actor,id,p,fingerprint):\n        if await self.writer.fetchval('SELECT EXISTS(SELECT 1 FROM intent_tombstones WHERE request_id=$1 OR (owner=$2 AND fingerprint=$3))',id,actor['id'],fingerprint):raise ValueError('unknown intent closed; explicit replacement policy required')")
    s=s.replace("{'fingerprint':fingerprint,'owner':actor['id']}","{'fingerprint':fingerprint,'owner':actor['id'],'source':p['source'],'request_id':str(id)}")
    return s
edit('controls.py',controls)
edit('freshness.py',lambda s:s.replace("kind=kind,input_sha=sha(input))", "kind=kind,input_sha=sha(input),context={'key':str(key),**{k:input[k] for k in ('owner','source','request_id','fingerprint') if k in input}})"))
def harness(s):
    s=s.replace("'freshness-audit-'","'concurrent-audit-'")
    s=s.replace("        self.app_config.update(freshness_url=", "        self.app_config['instance']=uuid.uuid4().hex\n        self.app_config.update(freshness_url=")
    s=s.replace("        self.app,self.api=self.process('application',self.app_config,env)","        self.app_env=env\n        self.app,self.api=self.process('application',self.app_config,env)")
    s=s.replace("        self.freshness_secret=secrets.token_hex(32)","        self.freshness_secret=secrets.token_hex(32);self.freshness_private=key.private_bytes_raw().hex()")
    s=s.replace("key.private_bytes_raw().hex(),'secret':self.freshness_secret", "self.freshness_private,'secret':self.freshness_secret,'caps':{'model':40,'stress':7}")
    s=s.replace("getattr(self,'freshness_secret','')", "getattr(self,'freshness_secret',''),getattr(self,'freshness_private','')")
    return s
edit('harness.py',harness)
edit('schema.sql',lambda s:s+'''
ALTER TABLE recovery_control ADD COLUMN IF NOT EXISTS joint_restore BOOL NOT NULL DEFAULT FALSE;
CREATE TABLE IF NOT EXISTS intent_proposals(seq BIGINT PRIMARY KEY,id UUID NOT NULL,evidence_sha TEXT NOT NULL,reason TEXT NOT NULL,prepared_by TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS intent_tombstones(request_id UUID PRIMARY KEY,owner TEXT NOT NULL,source TEXT NOT NULL,fingerprint TEXT NOT NULL,seq BIGINT UNIQUE NOT NULL,reason TEXT NOT NULL,prepared_by TEXT NOT NULL,confirmed_by TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS reconciliation_audit(id UUID PRIMARY KEY,seq BIGINT NOT NULL,actor TEXT NOT NULL,action TEXT NOT NULL,evidence_sha TEXT NOT NULL,recorded_at TEXT NOT NULL);
REVOKE ALL ON intent_proposals,intent_tombstones,reconciliation_audit FROM PUBLIC;
GRANT INSERT,SELECT ON intent_proposals,intent_tombstones,reconciliation_audit TO decision_writer;
''')
