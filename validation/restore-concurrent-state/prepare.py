from pathlib import Path
P=Path(__file__).parent
def edit(name,fn):
    f=P/name;f.write_text(fn(f.read_text(encoding='utf-8')),encoding='utf-8')
edit('application.py',lambda s:s.replace('from coordination import Coordination','from coordination import Coordination\nfrom maintenance import Maintenance').replace('class API(Coordination,Freshness,Controls):','class API(Maintenance,Coordination,Freshness,Controls):').replace('            await asyncio.Event().wait()',"            if json.loads(arm.read_text()).get('mode')=='pause':\n                release=Path(self.c['state'])/'pause-release.json'\n                while not release.exists() or not json.loads(release.read_text()).get('release'):await asyncio.sleep(.05)\n            else:await asyncio.Event().wait()"))
# Original fault consumes the arm file; capture mode before clearing it.
edit('application.py',lambda s:s.replace("            arm.write_text('{}')", "            mode=json.loads(arm.read_text()).get('mode')\n            arm.write_text('{}')").replace("if json.loads(arm.read_text()).get('mode')=='pause':", "if mode=='pause':"))
edit('controls.py',lambda s:s.replace("'principals','freshness_receipts']", "'principals','freshness_receipts','intent_proposals','intent_tombstones','reconciliation_audit','format_control']"))
def coordination(s):
    old="            self.recovering=bool(await self.db.fetchval('SELECT recovering FROM recovery_control WHERE id'))\n            if path.startswith('/freshness/')"
    new="            self.recovering=bool(await self.db.fetchval('SELECT recovering FROM recovery_control WHERE id'))\n            if await self.db.fetchval('SELECT frozen FROM backup_control WHERE id') and path not in ('/recovery/freeze','/recovery/thaw','/recovery/open'):\n                raise web.HTTPServiceUnavailable(text='installation frozen for coordinated backup')\n            if path.startswith('/freshness/')"
    assert old in s;return s.replace(old,new)
edit('coordination.py',coordination)
def harness(s):
    s=s.replace("'concurrent-audit-'","'restore-state-audit-'")
    marker='    def start(self):'
    methods='''    def start_peer(self):
        self.peer,self.peer_api=self.process('application',{**self.app_config,'instance':uuid.uuid4().hex},self.app_env)
        return self.peer_api
    def stop_apps(self):
        self.stop_app()
        if getattr(self,'peer',None) and self.peer.poll() is None:self.peer.terminate();self.peer.wait(timeout=10)
    def start_apps(self,restoring=False):
        self.start_app(restoring);self.start_peer()
'''
    return s.replace(marker,methods+marker)
edit('harness.py',harness)
edit('schema.sql',lambda s:s+'''
CREATE TABLE IF NOT EXISTS backup_control(id BOOL PRIMARY KEY DEFAULT TRUE CHECK(id),frozen BOOL NOT NULL,token UUID);
INSERT INTO backup_control VALUES(TRUE,FALSE,NULL) ON CONFLICT DO NOTHING;
CREATE TABLE IF NOT EXISTS format_control(id BOOL PRIMARY KEY DEFAULT TRUE CHECK(id),revision TEXT NOT NULL);
INSERT INTO format_control VALUES(TRUE,'restore-state-v1') ON CONFLICT DO NOTHING;
''')
