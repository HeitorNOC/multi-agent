"""Fault-controlled transport qualification; semantic responses are explicitly fixtures."""
import concurrent.futures
import hashlib,hmac,json,os,secrets,sqlite3,sys,time,uuid
from pathlib import Path
from urllib.request import Request,urlopen
from urllib.error import HTTPError

import pytest

HERE=Path(__file__).resolve().parent;ROOT=HERE.parents[1]
sys.path.insert(0,str(ROOT/'validation/langgraph-retained-flow'))
from test_signed_flow import SignedLab,PY,Rejected,request
from authority_client import request as signed_request

class DetachedLab(SignedLab):
    def __init__(self):
        super().__init__();self.state=HERE/'.state'/self.id;self.state.mkdir(parents=True)
        self.evidence_dir=HERE/'evidence';self.inference_key=secrets.token_hex(32)
        self.evidence['scope']='controlled slow inference, real TypeScript/SQLite/Ed25519/LangGraph/PostgreSQL; no semantic model'
    def authority(self):
        self.authority_config['caps']={'business':32};super().authority()
    def inference_service(self):
        self.inference_process,self.inference_url=self.service([str(PY),str(HERE/'fixture_provider.py')],
            {'path':str(self.state/'inference.sqlite'),'events':str(self.state/'inference-events.jsonl'),'key':self.inference_key})
        self.config['detachedInference']={'url':self.inference_url,'key':self.inference_key}
    def control(self,action,id='stats',**payload):
        raw=json.dumps({'action':action,'id':id,**payload,'issued':time.time()}).encode()
        sig=hmac.new(bytes.fromhex(self.inference_key),raw,hashlib.sha256).hexdigest()
        with urlopen(Request(self.inference_url+'/rpc',raw,{'x-signature':sig}),timeout=10) as response:return json.load(response)
    def start(self):
        super().start();self.stop_businesses();self.config['leaseMs']=2000
        self.inference_service();self.connect_authority();self.api_a=self.api;self.start_business()
    def admission(self,capability='policy_lookup'):
        job=self.new_signed([capability],execute=False,maxUnits=1)
        worker='worker-'+uuid.uuid4().hex
        claim=self.call('worker','claim',job=job['id'],worker=worker)
        payload={'job':job['id'],'worker':worker,'epoch':claim['epoch'],'capability':capability}
        row=self.call('worker','read_prepare',**payload)
        return job,payload,row
    def started(self,id):
        deadline=time.monotonic()+5
        while time.monotonic()<deadline:
            path=self.state/'inference-events.jsonl'
            if path.exists() and any(r['event']=='started' and r['id']==id for r in map(json.loads,path.read_text().splitlines())):return
            time.sleep(.01)
        raise AssertionError('inference never started')
    def read(self,payload,url=None):return request(url or self.api,self.tokens['worker'],{'action':'read',**payload})
    def reclaim(self,job,payload):
        self.call('board','fence',job=job['id'],reason='Controlled qualification recovery of worker lease')
        worker='worker-'+uuid.uuid4().hex;claim=self.call('worker','claim',job=job['id'],worker=worker)
        return {**payload,'worker':worker,'epoch':claim['epoch']}
    def count_reads(self,job):
        with sqlite3.connect(self.config['db']) as db:return db.execute('SELECT count(*) FROM reads WHERE job=?',(job['id'],)).fetchone()[0]

def test_detached_read_fencing_renewal_revocation_and_recovery():
    lab=DetachedLab();start=time.perf_counter();latencies=[]
    def denied(fn,status):
        with pytest.raises(Rejected) as error:fn()
        assert error.value.status==status,str(error.value)
    try:
        lab.start()
        with concurrent.futures.ThreadPoolExecutor(max_workers=10) as pool:
            job,p,row=lab.admission();lab.control('hold',row['id'])
            future=pool.submit(lab.read,p,lab.api_a);lab.started(row['id'])
            # The other API can journal unrelated work while inference is held.
            tick=time.perf_counter();other=lab.new_signed(['policy_lookup'],execute=False,maxUnits=1)
            lab.call('owner','status',job=other['id']);latencies.append(time.perf_counter()-tick)
            assert latencies[-1]<1.0
            for i in range(5):
                time.sleep(.5)
                lab.call('worker','renew',job=job['id'],worker=p['worker'],epoch=p['epoch'],request_id=str(uuid.uuid4()))
            lab.control('open',row['id']);assert future.result()['semantic']['native'] is False
            assert lab.count_reads(job)==1
            denied(lambda:lab.call('worker','read_commit',**p,semantic={'answer':'injected'}),400)
            with pytest.raises(HTTPError) as bound:lab.control('inference_run',row['id'],input_json='{}')
            assert bound.value.code==409
            lab.mark('two_apis_progress_and_lease_renewal_beyond_original_deadline')

            job,p,row=lab.admission();lab.control('hold',row['id']);future=pool.submit(lab.read,p);lab.started(row['id'])
            duplicates=[pool.submit(lab.read,p,lab.api_a) for _ in range(6)]
            for duplicate in duplicates:denied(duplicate.result,409)
            fresh=lab.reclaim(job,p);lab.control('open',row['id']);denied(future.result,409)
            assert lab.read(fresh)['semantic']['native'] is False
            denied(lambda:lab.call('worker','renew',job=job['id'],worker=p['worker'],epoch=p['epoch'],request_id=str(uuid.uuid4())),409)
            assert lab.count_reads(job)==1
            lab.mark('duplicate_admissions_one_provider_execution_and_stale_epoch_cannot_commit')

            job,p,row=lab.admission();lab.control('hold',row['id']);future=pool.submit(lab.read,p);lab.started(row['id'])
            time.sleep(2.15);lab.control('open',row['id']);denied(future.result,409)
            assert lab.count_reads(job)==0
            fresh=lab.reclaim(job,p);assert lab.read(fresh)['semantic']['native'] is False
            lab.mark('expired_lease_rejects_late_response_and_current_epoch_recovers_same_receipt')

            job,p,row=lab.admission('finance_review');lab.control('hold',row['id']);future=pool.submit(lab.read,p);lab.started(row['id'])
            tick=time.perf_counter();lab.call('board','revoke',principal='owner',source='aquisicao');latencies.append(time.perf_counter()-tick)
            assert latencies[-1]<1.0
            lab.control('open',row['id']);denied(future.result,403)
            assert lab.count_reads(job)==0
            denied(lambda:lab.call('owner','status',job=job['id']),403)
            denied(lambda:lab.read(p),403)
            lab.mark('revocation_during_inference_prevents_commit_and_delivery')

            job,p,row=lab.admission();lab.control('hold',row['id']);future=pool.submit(lab.read,p);lab.started(row['id'])
            lab.stop_businesses();lab.control('open',row['id'])
            try:future.result()
            except Exception:pass  # process death is intentional, not a successful response
            deadline=time.monotonic()+5
            while lab.control('inference_lookup',row['id'])['state']!='complete':
                assert time.monotonic()<deadline;time.sleep(.01)
            lab.start_business();fresh=lab.reclaim(job,p);assert lab.read(fresh)['semantic']['native'] is False
            lab.mark('business_process_loss_after_admission_recovers_provider_receipt_without_reexecution')

            job,p,row=lab.admission();lab.control('crash_after_receipt',row['id'])
            denied(lambda:lab.read(p),503);lab.inference_process.wait(timeout=5)
            lab.stop_businesses();lab.inference_service();lab.start_business();fresh=lab.reclaim(job,p)
            assert lab.read(fresh)['semantic']['native'] is False
            lab.mark('provider_process_loss_after_durable_receipt_recovers_without_reexecution')

            job,p,row=lab.admission();lab.control('crash_before_receipt',row['id'])
            denied(lambda:lab.read(p),503);lab.inference_process.wait(timeout=5)
            lab.stop_businesses();lab.inference_service();lab.start_business();fresh=lab.reclaim(job,p)
            for _ in range(3):denied(lambda:lab.read(fresh),409)
            assert lab.count_reads(job)==0
            lab.evidence['unknown_inference_id']=row['id']
            lab.mark('provider_admission_without_receipt_stays_unknown_and_never_reexecutes')

            current=lab.new_signed(['policy_lookup'],execute=False,maxUnits=1)
            assert lab.run_worker(current['id'])['completed']
            lab.mark('real_langgraph_worker_uses_detached_path')
        proof=signed_request(lab.authority_client,action='proof')
        stats=lab.control('stats')['rows'];assert len(stats)==8 and all(r[2]==1 for r in stats)
        assert sum(r[1]=='admitted' for r in stats)==1 and sum(r[1]=='complete' for r in stats)==7
        assert lab.call('board','retained_status')['current']
        assert not any(r['receipt_sha'] is None for r in proof['operations'])
        lab.evidence.update(result='PASS_BOUNDED_DETACHED_INFERENCE',control_latencies_seconds=latencies,provider_executions=stats,
                            signed_final={'budgets':proof['budgets'],'pending_operations':0})
    except BaseException as error:
        lab.evidence.update(result='FAIL',error=lab.redact(repr(error)));raise
    finally:
        lab.evidence['seconds']=time.perf_counter()-start
        try:lab.cleanup();lab.evidence['disposable_resources_removed']=True
        finally:lab.save()
