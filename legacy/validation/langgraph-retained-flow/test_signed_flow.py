"""Real TypeScript/LangGraph/Postgres plus independent signed retained authority."""
import concurrent.futures
import hashlib
import json
import os
from pathlib import Path
import secrets
import shutil
import socket
import sqlite3
import subprocess
import sys
import time
import uuid

import pytest
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey

HERE=Path(__file__).resolve().parent
ROOT=HERE.parents[1]
sys.path.insert(0,str(ROOT/'validation/langgraph-business-flow'))
from test_flow import Lab,Rejected,request,PY
sys.path.insert(0,str(ROOT/'validation/concurrent-reconciliation'))
from authority_client import request as signed_request


class SignedLab(Lab):
    def __init__(self):
        super().__init__()
        self.state=HERE/'.state'/self.id;self.state.mkdir(parents=True)
        self.evidence_dir=Path(os.environ.get('QUALIFICATION_EVIDENCE_DIR',str(HERE/'evidence')))
        self.evidence['scope']='signed authority integration; canonical-only knowledge; synthetic auth and tools'
        self.businesses=[]

    def save(self):
        self.evidence_dir.mkdir(exist_ok=True)
        (self.evidence_dir/'results.json').write_text(json.dumps(self.evidence,indent=2,ensure_ascii=False),encoding='utf-8')

    def start_business(self):
        super().start_business()
        self.businesses.append(self.business)

    def stop_businesses(self):
        for proc in self.businesses:
            if proc.poll() is None:proc.terminate();proc.wait(timeout=8)
        self.businesses=[]

    def authority(self):
        self.authority_process,self.authority_url=self.service([str(PY),str(ROOT/'validation/concurrent-reconciliation/freshness_authority.py')],self.authority_config)
        self.authority_client={'freshness_url':self.authority_url,'freshness_secret':self.authority_secret,
                               'freshness_public':self.public,'installation':self.id}
        self.config['retained']={'url':self.authority_url,'secret':self.authority_secret,'public':self.public,'scope':'business'}

    def connect_authority(self):
        self.stop_businesses()
        key=Ed25519PrivateKey.generate();self.public=key.public_key().public_bytes_raw().hex()
        self.authority_secret=secrets.token_hex(32)
        self.authority_config={'path':str(self.state/'retained-outside-backup.sqlite'),'installation':self.id,
                               'private_key':key.private_bytes_raw().hex(),'secret':self.authority_secret,
                               'caps':{'business':12},'evidence':str(self.state/'signed-proofs.jsonl')}
        self.authority();self.start_business()
        self.evidence_dir.mkdir(exist_ok=True)
        (self.evidence_dir/'authority-public.json').write_text(json.dumps({'installation':self.id,'public':self.public}),encoding='utf-8')

    def new_signed(self,capabilities=None,execute=True,maxUnits=4,request_id=None):
        return self.call('owner','create',capabilities=capabilities or ['policy_lookup','finance_review'],execute=execute,
                         maxUnits=maxUnits,request_id=request_id or str(uuid.uuid4()))

    def backup(self,name):
        self.stop_businesses();destination=self.state/name;destination.mkdir()
        active={'business.sqlite':Path(self.config['db']),'canonical.sqlite':Path(self.config['editorial'])}
        for filename,source in active.items():
            with sqlite3.connect(source) as original,sqlite3.connect(destination/filename) as copy:original.backup(copy)
        shutil.copytree(Path(self.config['vault']),destination/'vault')
        dump=self.docker('exec',self.container,'pg_dump','-U','postgres','-Fc','-n','runtime','postgres').stdout
        (destination/'runtime.dump').write_bytes(dump)
        manifest={p.name:hashlib.sha256(p.read_bytes()).hexdigest() for p in destination.iterdir() if p.is_file()}
        (destination/'backup-manifest.json').write_text(json.dumps(manifest,indent=2),encoding='utf-8')
        assert not (destination/'retained-outside-backup.sqlite').exists()
        return destination

    def activate(self,bundle,corrupt=None,new_postgres=False):
        self.stop_businesses()
        target=self.state/('restore-'+uuid.uuid4().hex[:8]);target.mkdir()
        for name in ['business.sqlite','canonical.sqlite']:shutil.copy2(bundle/name,target/name)
        shutil.copytree(bundle/'vault',target/'vault')
        if corrupt:
            with sqlite3.connect(target/corrupt[0]) as db:db.execute(corrupt[1])
        self.config.update(db=str(target/'business.sqlite'),editorial=str(target/'canonical.sqlite'),vault=str(target/'vault'))
        if new_postgres:self.restore_postgres(bundle/'runtime.dump')
        self.start_business()
        return target

    def restore_postgres(self,dump):
        container=self.id+'-pg-restored-'+uuid.uuid4().hex[:6];volume=container+'-data'
        with socket.socket() as sock:sock.bind(('127.0.0.1',0));port=sock.getsockname()[1]
        self.docker('volume','create','--label','qualification='+self.id,volume);self.docker_resources.append(('volume',volume))
        self.docker('run','-d','--name',container,'--label','qualification='+self.id,'--user','postgres','--cap-drop','ALL',
                    '--security-opt','no-new-privileges=true','--memory','512m','--cpus','1','--pids-limit','128',
                    '-e','POSTGRES_PASSWORD='+self.secret,'--mount',f'type=volume,src={volume},dst=/var/lib/postgresql/data',
                    '-p',f'127.0.0.1:{port}:5432',self.image)
        self.docker_resources.append(('container',container))
        deadline=time.monotonic()+45
        while self.docker('exec',container,'pg_isready','-h','127.0.0.1','-U','postgres',check=False).returncode:
            if time.monotonic()>deadline:raise RuntimeError('restored Postgres startup timeout')
            time.sleep(.2)
        self.docker('exec','-i',container,'psql','-Xq','-v','ON_ERROR_STOP=1','-U','postgres',
                    input=f"CREATE ROLE workflow_runtime LOGIN NOSUPERUSER NOBYPASSRLS PASSWORD '{self.secret}';".encode())
        self.docker('exec','-i',container,'pg_restore','-U','postgres','-d','postgres','--exit-on-error',input=dump.read_bytes())
        self.dsn=f'postgresql://workflow_runtime:{self.secret}@127.0.0.1:{port}/postgres?options=-csearch_path%3Druntime&connect_timeout=5'
        self.container=container;self.port=port
        self.evidence['cold_restore_new_postgres']={'container':container,'volume':volume}


def test_signed_budget_publication_and_restore():
    lab=SignedLab();started=time.perf_counter()
    def denied(fn,status):
        with pytest.raises(Rejected) as error:fn()
        assert error.value.status==status,str(error.value)
    try:
        lab.start();lab.connect_authority()
        initial=lab.call('board','retained_status');assert initial['current'] and initial['seq']==1
        lab.mark('typescript_verifies_real_signed_authority',seq=initial['seq'])
        task=lab.new_signed()
        unchanged=lab.call('board','retained_status')
        duplicate=lab.new_signed(request_id=task['id']);assert duplicate==task
        denied(lambda:lab.new_signed(request_id=task['id'],maxUnits=5),409)
        assert lab.call('board','retained_status')==unchanged
        lab.mark('stable_request_id_replays_and_binds_input_without_new_reservation')
        assert lab.run_worker(task['id'])['next']==['approval']
        oldest=lab.backup('g1-before-approval');lab.start_business()
        lab.call('board','approve',job=task['id'],hash=task['hash'])
        assert lab.run_worker(task['id'],resume=True)['completed']
        original=lab.call('owner','status',job=task['id'])['result']
        assert original['receipt']['deliveries']==1
        lab.mark('langgraph_approval_and_effect_with_retained_job_reservation')

        note=Path(lab.config['vault'])/'politica-remoto.md'
        note.write_text('---\nsource: politica-remoto\nversion: 2\nvalid_at: 2026-02-01T00:00:00Z\ndomain: publico\n---\nNova regra sintética: três dias remotos.',encoding='utf-8')
        draft=lab.call('owner','editorial',command={'action':'submit','path':'politica-remoto.md'})
        lab.call('board','editorial',command={'action':'review','id':draft['id'],'raw_sha':draft['raw_sha']})
        lab.call('board','editorial',command={'action':'commit','id':draft['id'],'receipt':{'fixture':'canonical-only'}})
        waiting=lab.new_signed(['policy_lookup'],execute=True,maxUnits=3)
        assert lab.run_worker(waiting['id'])['next']==['approval']
        lab.call('board','revoke',principal='owner',source='aquisicao')
        denied(lambda:lab.call('owner','status',job=task['id']),403)
        latest_status=lab.call('board','retained_status');assert latest_status['current']
        latest=lab.backup('g2-after-publication-and-revocation')
        lab.mark('source_publication_and_current_revocation_anchored',seq=latest_status['seq'])

        lab.activate(oldest)
        stale=lab.call('board','retained_status');assert not stale['current']
        denied(lambda:lab.call('owner','status',job=task['id']),503)
        lab.mark('old_customer_backup_refused_against_retained_history',reason=stale['reason'])

        lab.activate(latest,corrupt=('business.sqlite','UPDATE jobs SET spent=0,reserved=0'))
        assert not lab.call('board','retained_status')['current']
        denied(lambda:lab.call('board','state'),503)
        lab.activate(latest,corrupt=('canonical.sqlite',"UPDATE drafts SET content='Tampered approved source' WHERE state='published'"))
        assert not lab.call('board','retained_status')['current']
        denied(lambda:lab.call('board','state'),503)
        lab.mark('quota_reset_and_canonical_tampering_refused')

        lab.activate(latest,new_postgres=True)
        assert lab.call('board','retained_status')['current']
        denied(lambda:lab.call('owner','status',job=task['id']),403)
        assert lab.call('board','status',job=task['id'])['result']==original
        # Resume the actually restored approval checkpoint in a new worker/PG.
        lab.call('board','approve',job=waiting['id'],hash=waiting['hash'])
        assert lab.run_worker(waiting['id'],resume=True)['completed']
        resumed=lab.call('owner','status',job=waiting['id'])['result']
        assert resumed['evidence'][0]['snapshot']['version']==2 and resumed['receipt']['deliveries']==1
        public=lab.new_signed(['policy_lookup'],execute=False,maxUnits=1)
        assert lab.run_worker(public['id'])['completed']
        public_result=lab.call('owner','status',job=public['id'])['result']
        assert public_result['evidence'][0]['snapshot']['version']==2
        lab.mark('cold_restore_new_postgres_keeps_output_acl_and_published_version',approval_checkpoint_resumed_in_new_process=True)

        lab.authority_process.terminate();lab.authority_process.wait(timeout=8)
        denied(lambda:lab.call('board','state'),503)
        lab.authority();lab.stop_businesses();lab.start_business()
        assert lab.call('board','retained_status')['current']
        lab.mark('authority_outage_fails_closed_restart_preserves_budget')

        # Two real APIs share a retained commit lane and the same local ledger.
        second,second_api=lab.service(['node',str(ROOT/'validation/langgraph-business-flow/business.ts')],lab.config)
        lab.businesses.append(second)
        def admission(index):
            try:
                value=request(lab.api if index%2==0 else second_api,lab.tokens['owner'],
                              {'action':'create','capabilities':['policy_lookup'],'execute':True,'maxUnits':3,'request_id':str(uuid.uuid4())})
                return {'accepted':True,'id':value['id']}
            except Rejected as error:return {'accepted':False,'status':error.status,'error':str(error)}
        with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:attempts=list(pool.map(admission,range(8)))
        lab.evidence['retained_admissions']=attempts
        assert sum(x['accepted'] for x in attempts)==1,attempts
        assert all(x['accepted'] or x['status']==429 for x in attempts),attempts
        proof=signed_request(lab.authority_client,action='proof')
        assert proof['budgets']['business']=={'cap':12,'reserved':11}
        lab.evidence['signed_head']={'seq':proof['seq'],'head':proof['head'],'budgets':proof['budgets']}
        lab.mark('two_apis_atomic_retained_budget',attempts=8,admitted=1,reserved=11,cap=12)
        with sqlite3.connect(lab.state/'provider.sqlite') as provider:
            sends=provider.execute("SELECT key,count(*) FROM requests WHERE action='send' GROUP BY key").fetchall()
            receipt_count=provider.execute('SELECT count(*) FROM receipts').fetchone()[0]
        assert receipt_count==2 and len(sends)==2 and all(n==1 for _,n in sends)
        lab.evidence['provider']={'unique_receipts':2,'send_counts':dict(sends)}

        # An interrupted retained intent is never declared safe by a local backup.
        lab.call('board','retained_fault')
        try:lab.new_signed(['policy_lookup'],execute=False,maxUnits=1)
        except Exception:pass
        assert lab.business.wait(timeout=8)==77
        lab.stop_businesses();lab.start_business()
        pending=lab.call('board','retained_status');assert not pending['current']
        final_proof=signed_request(lab.authority_client,action='proof')
        assert final_proof['budgets']['business']['reserved']==12
        assert final_proof['operations'][-1]['receipt_sha'] is None
        lab.evidence['final_retained_state']={'seq':final_proof['seq'],'head':final_proof['head'],
                                              'budgets':final_proof['budgets'],'pending_count':sum(r['receipt_sha'] is None for r in final_proof['operations'])}
        lab.mark('crash_after_retained_intent_fences_reopening',reason=pending['reason'])
        lab.evidence['result']='PASS_BOUNDED_SIGNED_INTEGRATION'
    except BaseException as error:
        lab.evidence['result']='FAIL';lab.evidence['error']=lab.redact(repr(error));raise
    finally:
        lab.evidence['seconds']=time.perf_counter()-started
        try:lab.cleanup();lab.evidence['disposable_resources_removed']=True
        finally:lab.save()
