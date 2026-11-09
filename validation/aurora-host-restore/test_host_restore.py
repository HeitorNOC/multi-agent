"""Rebuild an Aurora installation from sealed custody and fresh local resources."""
import hashlib
import hmac
from http.cookiejar import CookieJar
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
from pathlib import Path
import secrets
import shutil
import sqlite3
import sys
import threading
import time
from urllib.error import HTTPError
from urllib.request import HTTPCookieProcessor, Request, build_opener, urlopen
from uuid import uuid4

from cryptography.exceptions import InvalidTag
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
import pytest

from bundle import authority_anchor, inventory, require_current_authority, seal, snapshot_db, verify

HERE=Path(__file__).resolve().parent
ROOT=HERE.parents[1]
sys.path[:0]=[str(ROOT/'validation/brain-recovery'),str(ROOT/'validation/aurora-queue'),str(ROOT/'demo'),str(ROOT/'demo-enterprise')]
from test_brain import BrainLab, PY, signed_request
from test_queue import eventually
from fixture_complete import AGENTS, LEAD, SPECIALIST
from model_gateway import call_model
from recovery_bridge import RecoveryBridge, reviewers

CATALOG={agent['id']:agent for agent in AGENTS}
CORPUS=ROOT/'demo-enterprise/corpus.json'
PROVIDER=ROOT/'validation/integrated-pilot/provider.py'


class RestoreLab(BrainLab):
    def __init__(self,root,custody):
        super().__init__()
        self.state=root/'engines';self.state.mkdir(parents=True)
        self.journey=root
        self.custody=custody
        self.evidence_dir=root/'private-evidence'
        self.native_state=self.state/'native'
        self.native_options={'profile':'enterprise-demo','synthetic_corpus_sha':hashlib.sha256(CORPUS.read_bytes()).hexdigest(),
            'model_slots_path':str(root/'model-slots.sqlite'),'fixture_calls':str(root/'dispatches.jsonl'),
            'fixture_drop':str(root/'drop-next-slot')}
        self.embedding_options={'pool_long_inputs':True}
        self.tokens['reviewer2']=secrets.token_hex(24)

    def service(self,args,config):
        script=Path(args[1]).name
        if script=='native.py':args=[args[0],str(HERE/'fixture_native.py')]
        if script=='embedding_server.py':self.embedding_start=(args,dict(config))
        return super().service(args,config)

    def authority(self):
        self.authority_config.update(path=str(self.custody/'authority.sqlite'),evidence=str(self.custody/'proofs.jsonl'))
        super().authority()

    def start_business(self):
        if not any(p['id']=='reviewer2' for p in self.config['principals']):
            self.config['principals'].append({'id':'reviewer2','role':'board','installation':self.id,
                'sources':['politica-remoto','aquisicao'],'token':self.tokens['reviewer2']})
        super().start_business()

    def proof(self):
        return signed_request(self.authority_client,action='model_slot_list')

    def stage_documents(self):
        sources=set(SPECIALIST['sources'])|set(CATALOG[LEAD]['sources'])
        docs={}
        for doc in json.loads(CORPUS.read_text(encoding='utf-8'))['documents']:
            if not doc['current'] or doc['source'] not in sources:continue
            content_sha=hashlib.sha256(doc['content'].encode()).hexdigest()
            payload={'installation':self.id,'source':doc['source'],'version':doc['version'],'content_sha':content_sha,
                     'raw_sha':content_sha,'domain':doc['area'],'draft':uuid4().hex,'reviewer':'aurora-fixture-reviewer',
                     'valid_at':'2026-11-01T00:00:00Z','known_at':'2026-11-05T00:00:00Z'}
            raw=json.dumps(payload,ensure_ascii=False,separators=(',',':'))
            signature=hmac.new(bytes.fromhex(self.config['editorialKey']),raw.encode(),hashlib.sha256).hexdigest()
            certificate=self.native('stage',release={'payload':payload,'payload_json':raw,'signature':signature,'content':doc['content']})
            docs[doc['source']]={**doc,'projection':certificate['id'],'sha256':content_sha,'inventory_sha':certificate['inventory_sha']}
        assert set(docs)==sources
        return docs

    def metadata(self,docs):
        return {'id':self.id,'public':self.public,'secret':self.secret,'provider_key':self.provider_key,
                'authority_config':self.authority_config,'tokens':self.tokens,'config':self.config,
                'kek':self.kek.hex(),'image':self.image,'embedding':self.embedding_start[1],
                'docs':docs,'anchor':authority_anchor(self.proof())}

    def rebuild(self,bundle,metadata):
        for name in ('id','public','secret','provider_key','tokens','image','config','authority_config'):
            setattr(self,name,metadata[name])
        self.kek=bytes.fromhex(metadata['kek'])
        self.authority_secret=self.authority_config['secret']
        self.authority()
        require_current_authority(self.proof(),metadata['anchor'])
        for name in ('journey.sqlite','telemetry-outbox.sqlite','model-slots.sqlite','provider.sqlite'):
            shutil.copyfile(bundle/name,self.journey/name)
        _,provider_url=self.service([str(PY),str(PROVIDER)],{'path':str(self.journey/'provider.sqlite'),'secret':self.provider_key})
        self.config['provider']=provider_url
        embedding={**metadata['embedding'],'evidence':str(self.state/'embedding-calls.jsonl')}
        python=ROOT/'validation/decision-qualification/.embedding-venv/Scripts/python.exe'
        _,self.embedding_url=self.service([str(python),str(ROOT/'validation/concurrent-reconciliation/embedding_server.py')],embedding)
        self.restore_brain(bundle)
        assert self.call('board','brain_status')['frozen']
        for source in metadata['docs'].values():
            certificate=self.native('verify',id=source['projection'])
            assert certificate['inventory_sha']==source['inventory_sha']
            assert certificate['inventory']['nodes'] and certificate['inventory']['edges']
        self.call('board','brain_open',request_id=str(uuid4()))


def http(url,path,body=None,headers=None,client=None):
    req=Request(url+path,None if body is None else json.dumps(body,ensure_ascii=False).encode(),
                {'content-type':'application/json',**(headers or {})})
    try:
        with (client.open if client else urlopen)(req,timeout=25) as response:
            return response.status,json.load(response)
    except HTTPError as error:return error.code,json.load(error)


class Aurora:
    def __init__(self,lab,docs,resume_reserve=0):
        self.lab=lab
        self.docs=docs
        self.token=secrets.token_hex(32)
        self.recovery_key=secrets.token_hex(32)
        self.ready=threading.Event()
        self.held=threading.Event()
        self.release=threading.Event()
        self.ready.set()
        owner=self

        class Handler(BaseHTTPRequestHandler):
            def log_message(self,*args):pass

            def do_POST(self):
                assert self.headers.get('x-demo-token')==owner.token
                p=json.loads(self.rfile.read(int(self.headers['content-length'])))
                status=200
                try:
                    value=owner.handle(p,self.headers)
                except (OSError,ValueError):
                    status=503;value={'error':'runtime unavailable'}
                self.send_response(status);self.end_headers()
                try:self.wfile.write(json.dumps(value).encode())
                except OSError:pass

        self.server=ThreadingHTTPServer(('127.0.0.1',0),Handler)
        self.backend='http://127.0.0.1:'+str(self.server.server_port)
        threading.Thread(target=self.server.serve_forever,daemon=True).start()
        self.reviewers=reviewers(lab.journey/'reviewers.private.json',lab.id)
        self.process,self.api=lab.service(['node',str(ROOT/'demo/server.ts')],{
            'state':str(lab.journey),'root':str(ROOT),'installation':lab.id,'token':self.token,'backend':self.backend,
            'python':str(PY),'worker':str(ROOT/'demo-enterprise/worker.py'),'policyModule':(ROOT/'demo-enterprise/policy.ts').as_uri(),
            'queueCapacity':8,'resumeReserve':resume_reserve,'maxWorkers':2,'governedModelSlots':True,'evidenceContract':True,
            'recoveryBridgeKey':self.recovery_key,'recoveryReviewers':self.reviewers})

    def handle(self,p,headers):
        action=p['action'];lab=self.lab
        if action=='status':return {'phase':'ready','sources':list(self.docs.values())}
        if action=='worker_config':
            if not self.ready.is_set():raise ValueError('scheduler barrier')
            return {'dsn':lab.dsn,'backend':self.backend}
        if action=='model_job_status':return lab.native('model_slot_status',job=p['job'])
        if action=='recovery_bridge':
            assert headers.get('x-recovery-bridge-token')==self.recovery_key
            return RecoveryBridge(lab,model_slots=True).call(p)
        code,job=self.call('/internal/model_snapshot',{'job':p['job'],'model_lease':p['model_lease']},{'x-demo-token':self.token})
        if code!=200:raise ValueError('inactive worker')
        if action=='llm':
            drop=Path(lab.native_options['fixture_drop']).exists()
            try:return call_model(lab,job,p['slot'],p['prompt'],CATALOG)
            except HTTPError:
                if drop:
                    self.ready.clear();self.held.set();self.release.wait(60)
                raise
        assert action=='retrieve' and p['agent'] in job['plan']['capabilities']
        rows=[]
        for source in CATALOG[p['agent']]['sources']:
            doc=self.docs[source]
            result=lab.native('query',id=doc['projection'],query=doc['title'],mode='mix',only_need_context=True,
                              hl_keywords=['política'],ll_keywords=['Grupo Aurora'])
            context=result['answer']
            assert isinstance(context,str) and '[no-context]' not in context
            rows.append({**doc,'projection_id':doc['projection'],'context':context})
        return rows

    def call(self,path,body=None,headers=None,client=None):return http(self.api,path,body,headers,client)

    def submit(self,key=None):
        code,value=self.call('/api/jobs',{'scenario':'incident'},{'Idempotency-Key':key or uuid4().hex})
        assert code==202
        return value['id']

    def job(self,id):return next(job for job in self.call('/api/state')[1]['jobs'] if job['id']==id)

    def wait(self,id,state):return eventually(lambda:self.job(id)['status']==state,seconds=100)

    def approve(self,id,crash=False):
        assert self.call('/api/jobs/'+id+'/approve',{'hash':self.job(id)['review']['hash'],'crash_after_effect':crash})[0]==202

    def client(self,index):
        client=build_opener(HTTPCookieProcessor(CookieJar()))
        assert self.call('/api/recovery/session',{'credential':self.reviewers[index]['credential']},client=client)[0]==200
        return client

    def close(self):
        if self.process.poll() is None:self.process.terminate();self.process.wait(timeout=8)
        self.release.set()
        self.server.shutdown();self.server.server_close()


def test_complete_installation_restore(tmp_path,monkeypatch):
    monkeypatch.delenv('BRAIN_DETACHED_PROFILE',raising=False)
    custody=tmp_path/'custody';custody.mkdir()
    source=RestoreLab(tmp_path/'source',custody)
    target=None
    original=restored=None
    try:
        source.start()
        docs=source.stage_documents()
        original=Aurora(source,docs)
        effect=original.submit();original.wait(effect,'awaiting_approval');original.approve(effect,crash=True)
        original.wait(effect,'interrupted');receipt=original.job(effect)['receipt']
        pending=original.submit();original.wait(pending,'awaiting_approval')
        pending_hash=original.job(pending)['review']['hash']
        (source.journey/'drop-next-slot').touch()
        running=original.submit();assert original.held.wait(45)
        assert original.job(running)['status']=='running'
        queue_key=uuid4().hex
        queued=original.submit(queue_key)
        assert original.job(queued)['status']=='queued'
        frozen_jobs={id:original.job(id)['status'] for id in (effect,pending,running,queued)}
        source_container,source_neo=source.container,source.neo_name
        original.close();original=None

        def checkpoint_writer_released():
            # UUID generated by the API. The diagnostic connection releases the lock on exit.
            sql=f"SELECT pg_try_advisory_lock(hashtextextended('aurora:{running}',0))"
            return source.docker('exec',source.container,'psql','-U','postgres','-d','postgres','-Atc',sql).stdout.strip()==b't'

        eventually(checkpoint_writer_released,seconds=20)

        backup_started=time.perf_counter()
        source_bundle=source.backup_brain('transfer')
        transfer=tmp_path/'transfer';shutil.copytree(source_bundle,transfer)
        for name in ('journey.sqlite','telemetry-outbox.sqlite','model-slots.sqlite'):
            snapshot_db(source.journey/name,transfer/name)
        snapshot_db(source.state/'provider.sqlite',transfer/'provider.sqlite')
        assert {'authority.sqlite','restore.key','sealed-generation'}.isdisjoint(inventory(transfer))
        key=AESGCM.generate_key(bit_length=256)
        (custody/'restore.key').write_bytes(key)
        seal(transfer,custody,key,source.metadata(docs))
        backup_seconds=time.perf_counter()-backup_started
        source.cleanup();source.children=[];source.logs=[];source.docker_resources=[]
        assert source.docker('inspect',source_container,check=False).returncode!=0
        assert source.docker('inspect',source_neo,check=False).returncode!=0

        bad=tmp_path/'tampered';shutil.copytree(transfer,bad)
        with (bad/'journey.sqlite').open('ab') as stream:stream.write(b'tamper')
        with pytest.raises(ValueError,match='custody'):verify(bad,custody,key)
        with pytest.raises(InvalidTag):verify(transfer,custody,AESGCM.generate_key(bit_length=256))

        recovery_started=time.perf_counter()
        metadata=verify(transfer,custody,(custody/'restore.key').read_bytes())
        target=RestoreLab(tmp_path/'target',custody)
        target.rebuild(transfer,metadata)
        assert target.container!=source_container and target.neo_name!=source_neo
        assert all(Path(target.config[field]).is_relative_to(target.state) for field in ('db','editorial','vault'))
        restored=Aurora(target,metadata['docs'])
        assert restored.job(pending)['status']=='awaiting_approval' and not restored.job(pending)['approval']
        assert restored.job(pending)['review']['hash']==pending_hash
        with sqlite3.connect(target.journey/'journey.sqlite') as db:
            assert db.execute('SELECT job FROM effects').fetchall()==[(effect,)]
        assert restored.job(running)['status']=='interrupted'
        assert restored.submit(queue_key)==queued
        restored.wait(queued,'awaiting_approval')
        service_seconds=time.perf_counter()-recovery_started

        assert restored.call('/api/jobs/'+effect+'/resume',{})[0]==202
        restored.wait(effect,'completed')
        assert restored.job(effect)['receipt']==receipt
        assert restored.call('/api/jobs/'+running+'/resume',{})[0]==202
        restored.wait(running,'recovery_required')
        first,second=restored.client(0),restored.client(1)
        cases=restored.call('/api/recovery/cases',client=first)[1]['cases']
        case=next(case for case in cases if case['job_id']==running)
        inspection=restored.call('/api/recovery/inspect',{'case_id':case['case_id']},client=first)[1]
        binding={key:inspection[key] for key in ('case_id','operation_id','evidence_sha')}
        reason='Confirmar o encerramento da tentativa original sem recibo e sem nova inferência.'
        assert restored.call('/api/recovery/propose',{**binding,'reason':reason,'request_id':str(uuid4())},client=first)[0]==200
        assert restored.call('/api/recovery/confirm',{**binding,'request_id':str(uuid4())},client=first)[0]==403
        assert restored.call('/api/recovery/confirm',{**binding,'request_id':str(uuid4())},client=second)[0]==200
        restored.wait(running,'closed_unknown')
        assert restored.call('/api/jobs/'+running+'/resume',{})[0]==409
        restored.approve(pending);restored.wait(pending,'completed')

        proof=target.proof()
        dispatches=[json.loads(line) for line in (target.journey/'dispatches.jsonl').read_text().splitlines()]
        assert len(dispatches)==4
        assert proof['budgets']['model']['reserved']==13
        assert len([item for item in proof['model_slots'] if item['state']=='closed_unknown'])==1
        with sqlite3.connect(target.journey/'journey.sqlite') as db:
            assert db.execute('SELECT count(*) FROM effects').fetchone()[0]==2
        result={'result':'PASS_LOCAL_HOST_LOSS_DRILL','backup_seconds':round(backup_seconds,3),
                'recovery_to_working_queue_seconds':round(service_seconds,3),
                'recovery_and_checks_seconds':round(time.perf_counter()-recovery_started,3),
                'jobs_at_cut':sorted(frozen_jobs.values()),'jobs_recovered':4,'documents_recovered':len(docs),
                'bundle_files':len(inventory(transfer)),'new_model_dispatches':len(dispatches),
                'model_reservations':13,'effect_receipts':2,'paid_model_calls':0,
                'tampered_bundle_rejected':True,'wrong_key_rejected':True,'authority_process_recreated':True,
                'checkpoint_writer_released_at_cut':True,'original_database_containers_removed':True,
                'rpo_scope':'four known jobs at a fenced cut; no ongoing replication measured'}
        (HERE/f'evidence-{uuid4().hex[:10]}.json').write_text(json.dumps(result,indent=2),encoding='utf-8')
    finally:
        if original:original.close()
        if restored:restored.close()
        if target:target.cleanup()
        if source.children or source.docker_resources:source.cleanup()
