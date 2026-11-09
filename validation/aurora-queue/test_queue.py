"""API, queue, worker, PostgreSQL and governed provider in one local exercise."""
from collections import Counter
from concurrent.futures import ThreadPoolExecutor
import hashlib
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import math
from pathlib import Path
import sqlite3
import subprocess
import sys
import threading
import time
from urllib.error import HTTPError
from urllib.request import Request, urlopen
from uuid import uuid4

import pytest

HERE=Path(__file__).resolve().parent
ROOT=HERE.parents[1]
sys.path.insert(0,str(ROOT/'validation/aurora-model-slots'))
from test_slots import NativeLab, PY, call_model


class Lab(NativeLab):
    model_cap=80

    def service(self,args,config):
        if Path(args[1]).name=='fixture_native.py':
            args=[args[0],str(HERE/'fixture_complete.py')]
        return super().service(args,config)


def eventually(predicate,seconds=90):
    deadline=time.monotonic()+seconds
    while time.monotonic()<deadline:
        result=predicate()
        if result:return result
        time.sleep(.08)
    raise AssertionError('queue condition did not converge')


@pytest.mark.parametrize('max_workers',[1,2],ids=['serial','parallel'])
def test_queue_survives_restart_and_finishes_work_under_pressure(tmp_path,monkeypatch,max_workers):
    for key,value in {'POSTGRES_PASSWORD':'fixture-password','NEO4J_URI':'bolt://127.0.0.1:1',
                      'NEO4J_USERNAME':'fixture','NEO4J_PASSWORD':'fixture-password'}.items():
        monkeypatch.setenv(key,value)
    lab=Lab(tmp_path)
    agents={a['id']:a for a in json.loads((ROOT/'demo-enterprise/catalog.json').read_text(encoding='utf-8'))['agents']}
    docs={d['source']:{**d,'projection':'fixture:'+d['source'],'sha256':hashlib.sha256(d['content'].encode()).hexdigest()}
          for d in json.loads((ROOT/'demo-enterprise/corpus.json').read_text(encoding='utf-8'))['documents'] if d['current']}
    release=threading.Event();first_worker=threading.Event();ready=threading.Event();ready.set()
    stale={}

    def rpc(url,path,body=None,headers=None):
        request=Request(url+path,None if body is None else json.dumps(body).encode(),
                        {'content-type':'application/json',**(headers or {})})
        try:
            with urlopen(request,timeout=12) as response:return response.status,json.load(response)
        except HTTPError as error:return error.code,json.load(error)

    class Runtime(BaseHTTPRequestHandler):
        def log_message(self,*args):pass

        def do_POST(self):
            assert self.headers.get('x-demo-token')==lab.secret
            p=json.loads(self.rfile.read(int(self.headers['content-length'])))
            action=p['action'];status=200
            try:
                if action=='status':value={'phase':'ready' if ready.is_set() else 'starting','sources':list(docs.values())}
                elif action=='worker_config':
                    if not ready.is_set():raise ValueError('runtime held by test')
                    value={'dsn':lab.dsn,'backend':backend}
                elif action=='model_job_status':value=lab.native('model_slot_status',job=p['job'])
                elif action in ('llm','retrieve'):
                    if action=='llm' and not first_worker.is_set():
                        stale.update(job=p['job'],model_lease=p['model_lease']);first_worker.set()
                        assert release.wait(40)
                    code,job=rpc(api,'/internal/model_snapshot',{'job':p['job'],'model_lease':p['model_lease']},
                                 {'x-demo-token':lab.secret})
                    if code!=200:raise ValueError('inactive worker')
                    if action=='llm':value=call_model(lab,job,p['slot'],p['prompt'],agents)
                    else:
                        assert p['agent'] in job['plan']['capabilities']
                        value=[{**docs[source],'projection_id':docs[source]['projection'],'context':docs[source]['content']}
                               for source in agents[p['agent']]['sources']]
                else:raise AssertionError(action)
            except (OSError,ValueError):status=503;value={'error':'runtime unavailable'}
            self.send_response(status);self.end_headers();self.wfile.write(json.dumps(value).encode())

    server=ThreadingHTTPServer(('127.0.0.1',0),Runtime)
    backend='http://127.0.0.1:'+str(server.server_port)
    threading.Thread(target=server.serve_forever,daemon=True).start()
    try:
        lab.start_authority();lab.start_native();lab.start()
        config={'state':str(tmp_path),'root':str(ROOT),'installation':lab.id,'token':lab.secret,'backend':backend,
                'python':str(PY),'worker':str(ROOT/'demo-enterprise/worker.py'),
                'policyModule':(ROOT/'demo-enterprise/policy.ts').as_uri(),'queueCapacity':8,'maxWorkers':max_workers,
                'governedModelSlots':True,'evidenceContract':True}
        node=[ 'node',str(ROOT/'demo/server.ts') ]
        process,api=lab.service(node,config)
        original_api=api
        config['port']=int(api.rsplit(':',1)[1])
        def post(key,scenario='incident'):
            return rpc(api,'/api/jobs',{'scenario':scenario},{'Idempotency-Key':key})
        def jobs():return rpc(api,'/api/state')[1]['jobs']
        def job(id):return next(value for value in jobs() if value['id']==id)

        first_key=uuid4().hex
        code,first=post(first_key);assert code==202
        assert first_worker.wait(25)
        assert job(first['id'])['status']=='running'
        ready.clear()
        second_server=subprocess.run(node,input=json.dumps(config),encoding='utf-8',capture_output=True,timeout=8)
        assert second_server.returncode!=0 and 'locked' in second_server.stderr

        keys=[uuid4().hex for _ in range(24)]
        started=time.perf_counter()
        with ThreadPoolExecutor(max_workers=24) as pool:
            responses=list(pool.map(post,keys))
        admission_seconds=time.perf_counter()-started
        assert Counter(code for code,_ in responses)=={202:8,429:16}
        accepted={key:value['id'] for key,(code,value) in zip(keys,responses) if code==202}
        accepted_key,next_id=next(iter(accepted.items()))
        assert post(accepted_key)[1]=={'id':next_id,'status':'queued','replayed':True}
        assert post(accepted_key,'campaign')[0]==409
        assert len(jobs())==9
        with sqlite3.connect(tmp_path/'journey.sqlite') as db:
            fifo=[row[0] for row in db.execute('SELECT job FROM job_queue ORDER BY seq')]
        assert set(fifo)==set(accepted.values())

        process.terminate();process.wait(timeout=10)
        _,api=lab.service(node,config)
        assert api==original_api
        release.set()
        assert job(first['id'])['status']=='interrupted'
        assert rpc(api,'/internal/model_snapshot',stale,{'x-demo-token':lab.secret})[0]==403
        assert rpc(api,'/internal/effect',{**stale,'hash':'invalid'},{'x-demo-token':lab.secret})[0]==403
        assert post(accepted_key)[1]['id']==next_id
        assert rpc(api,'/api/state')[1]['queue']=={'capacity':8,'pending':8,'running':0,'max_workers':max_workers}
        ready.set()
        started=time.perf_counter()
        def waiting(ids):
            state=jobs()
            return ids<={j['id'] for j in state if j['status']=='awaiting_approval'}
        eventually(lambda:waiting(set(fifo)))
        review_seconds=time.perf_counter()-started
        assert rpc(api,'/api/jobs/'+first['id']+'/resume',{})[0]==202
        eventually(lambda:waiting({first['id']}))
        assert len(lab.dispatches())==9*4
        assert rpc(api,'/api/jobs/'+fifo[0]+'/approve',{'hash':'divergent'})[0]==409
        with sqlite3.connect(tmp_path/'journey.sqlite') as db:
            assert db.execute('SELECT count(*) FROM effects').fetchone()[0]==0
            dequeued=[row[0] for row in db.execute("SELECT job FROM events WHERE node='job_dequeued' ORDER BY seq")]
        assert dequeued==[first['id'],*fifo,first['id']]

        approvals_started=time.perf_counter()
        for n,id in enumerate(fifo):
            assert rpc(api,'/api/jobs/'+id+'/approve',{'hash':job(id)['review']['hash'],'crash_after_effect':n==0})[0]==202
        eventually(lambda:job(fifo[0])['status']=='interrupted')
        receipt=job(fifo[0])['receipt']
        assert receipt and rpc(api,'/api/jobs/'+fifo[0]+'/resume',{})[0]==202
        eventually(lambda:all(job(id)['status']=='completed' for id in fifo))
        completion_seconds=time.perf_counter()-approvals_started
        assert job(fifo[0])['receipt']==receipt
        assert rpc(api,'/api/jobs/'+first['id']+'/reject',{'hash':job(first['id'])['review']['hash']})[0]==200

        # Two consecutive waves under the same process, without a restart or injected fault.
        waves=[]
        for _ in range(2):
            started=time.perf_counter()
            with ThreadPoolExecutor(max_workers=4) as pool:
                results=list(pool.map(post,[uuid4().hex for _ in range(4)]))
            assert all(code==202 for code,_ in results)
            ids={value['id'] for _,value in results}
            eventually(lambda:waiting(ids))
            review_time=time.perf_counter()-started
            for id in sorted(ids):
                assert rpc(api,'/api/jobs/'+id+'/approve',{'hash':job(id)['review']['hash']})[0]==202
            eventually(lambda:all(job(id)['status']=='completed' for id in ids))
            waves.append({'jobs':len(ids),'seconds_to_review':round(review_time,3),
                          'seconds_to_complete':round(time.perf_counter()-started,3)})
        proof=lab.proof()
        assert len(lab.dispatches())==proof['budgets']['model']['reserved']==68
        assert len({call['id'] for call in lab.dispatches()})==68
        with sqlite3.connect(tmp_path/'journey.sqlite') as db:
            effects=db.execute('SELECT job,receipt FROM effects').fetchall()
            assert len(effects)==16
            assert len({json.loads(value)['id'] for _,value in effects})==16
            assert all(json.loads(value)['job']==id for id,value in effects)
            assert db.execute('SELECT count(*) FROM job_queue').fetchone()[0]==0
            waits=sorted(json.loads(row[0])['wait_ms'] for row in db.execute("SELECT detail FROM events WHERE node='job_dequeued'"))
            peak=max(json.loads(row[0])['running'] for row in db.execute("SELECT detail FROM events WHERE node='worker_started'"))
        assert peak==max_workers
        evidence={'capacity':8,'burst':24,'admitted':8,'saturated_http_429':16,'admission_seconds':round(admission_seconds,3),
                  'worker_limit':max_workers,'peak_active_workers':peak,'consecutive_waves':waves,
                  'seconds_to_review_8_after_restart':round(review_seconds,3),'seconds_approval_to_completion_8':round(completion_seconds,3),
                  'queue_wait_p95_ms':waits[math.ceil(len(waits)*.95)-1],'jobs_completed':16,'jobs_rejected':1,
                  'durable_fifo':True,'api_restarted_at_same_address':True,'receipt_replayed_after_crash':True,'reservations':68,'provider_dispatches':68,
                  'paid_model_calls':0,'postgres_image':lab.image,'versions':lab.evidence['versions']}
        (HERE/f'evidence-{uuid4().hex[:10]}.json').write_text(json.dumps(evidence,indent=2),encoding='utf-8')
    finally:
        release.set();server.shutdown();server.server_close();lab.cleanup()
