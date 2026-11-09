"""Cold restore and progressive load against the actual local runtime boundaries."""
import asyncio
from collections import Counter
from concurrent.futures import ThreadPoolExecutor
from hashlib import sha256
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import math
from pathlib import Path
import shutil
import sqlite3
import sys
import threading
import time
from urllib.error import HTTPError
from urllib.request import Request, urlopen
from uuid import uuid4

from langgraph.checkpoint.postgres.aio import AsyncPostgresSaver
from langgraph.graph import END, START, StateGraph
from langgraph.types import Command, interrupt
import pytest
from typing import TypedDict

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
sys.path[:0] = [str(HERE.parent/'aurora-model-slots'),str(HERE.parent/'langgraph-retained-flow')]
from test_slots import lab, PY
from test_signed_flow import SignedLab

EVIDENCE = HERE/'evidence'/uuid4().hex[:12]


def evidence(name, value):
    EVIDENCE.mkdir(parents=True,exist_ok=True)
    output = EVIDENCE/(name+'.json')
    with output.open('x',encoding='utf-8') as stream:
        json.dump(value,stream,ensure_ascii=False,indent=2)


class State(TypedDict, total=False):
    review: str
    result: str


async def checkpoint(dsn, resume=False):
    def review(state):
        verdict = interrupt({'review':state['review']})
        return {'result':state['review']+' '+verdict}

    async with AsyncPostgresSaver.from_conn_string(dsn) as saver:
        await saver.setup()
        graph = StateGraph(State)
        graph.add_node('review',review)
        graph.add_edge(START,'review')
        graph.add_edge('review',END)
        app = graph.compile(checkpointer=saver)
        config = {'configurable':{'thread_id':'qualification-restore-checkpoint'}}
        if resume:
            before = await app.aget_state(config)
            assert before.next==('review',) and before.values=={'review':'proposta sintética'}
            return await app.ainvoke(Command(resume='confirmada'),config,durability='sync')
        await app.ainvoke({'review':'proposta sintética'},config,durability='sync')
        assert (await app.aget_state(config)).next==('review',)


def run_checkpoint(dsn, resume=False):
    if sys.platform=='win32':
        asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())
    return asyncio.run(checkpoint(dsn,resume))


def test_restore_new_directory_and_postgres_volume(lab):
    started=time.perf_counter()
    lab.start()
    run_checkpoint(lab.dsn)
    known={'job':'preserved-job','slot':'plan','prompt':'Planejamento fictício','limit':1}
    unknown={'job':'uncertain-job','slot':'plan','prompt':'Interromper antes do recibo','limit':1}
    late={'job':'after-backup-job','slot':'plan','prompt':'Planejamento após snapshot','limit':1}
    first=lab.native('model_slot_run',**known)
    with pytest.raises(OSError):lab.native('model_slot_run',**unknown)
    assert lab.process.wait(timeout=10)==84
    lab.start_native()

    backup_started=time.perf_counter()
    backup=lab.state/'bundle'
    backup.mkdir()
    with sqlite3.connect(lab.path) as source, sqlite3.connect(backup/lab.path.name) as dest:
        source.backup(dest)
    dump=backup/'runtime.dump'
    dump.write_bytes(lab.docker('exec',lab.container,'pg_dump','-U','postgres','-Fc','-n','runtime','postgres').stdout)
    manifest={file.name:sha256(file.read_bytes()).hexdigest() for file in backup.iterdir()}
    backup_seconds=time.perf_counter()-backup_started
    assert set(manifest)=={'runtime.dump','model-slots.sqlite'}
    lab.native('model_slot_run',**late)
    assert len(lab.dispatches())==3

    # Remove both original writers from service. The independent authority remains live.
    restore_started=time.perf_counter()
    lab.process.terminate()
    lab.process.wait(timeout=8)
    lab.business.terminate()
    lab.business.wait(timeout=8)
    source_container=lab.container
    lab.docker('stop',source_container)
    restored=lab.state/'restored'
    restored.mkdir()
    lab.path=restored/'model-slots.sqlite'
    assert all(sha256((backup/name).read_bytes()).hexdigest()==digest for name,digest in manifest.items())
    shutil.copyfile(backup/lab.path.name,lab.path)
    SignedLab.restore_postgres(lab,dump)
    assert lab.container!=source_container
    lab.start_native()

    assert run_checkpoint(lab.dsn,resume=True)=={'review':'proposta sintética','result':'proposta sintética confirmada'}
    assert lab.native('model_slot_run',**known)==first
    assert lab.native('model_slot_status',job=unknown['job'])['status']=='review_required'
    assert lab.native('model_slot_status',job=late['job'])['status']=='receipt_unavailable'
    for args in (unknown,late):
        with pytest.raises(HTTPError,match='409'):lab.native('model_slot_run',**args)
    proof=lab.proof()
    assert proof['budgets']['model']['reserved']==len(lab.dispatches())==3
    evidence('restore',{
        'result':'PASS','scope':'simulated local cold restore; authority survives independently',
        'postgres_image':lab.image,'backup_seconds':round(backup_seconds,3),
        'restore_and_validation_seconds':round(time.perf_counter()-restore_started,3),
        'total_seconds':round(time.perf_counter()-started,3),'manifest':manifest,
        'source_postgres_stopped':True,'new_volume':True,'checkpoint_resumed':True,
        'known_receipt_replayed':True,'unknown_preserved':True,'post_snapshot_receipt_fenced':True,
        'reservations':3,'synthetic_provider_dispatches_after_restore':0,'paid_model_calls':0,
        'rpo_measured':False,'rto_sla_qualified':False,
    })


def test_progressive_replay_load(lab):
    args={'job':'read-load','slot':'plan','prompt':'Planejamento de carga fictício','limit':1}
    expected=lab.native('model_slot_run',**args)
    target_p95=1.0
    stages=[]

    def call(_):
        started=time.perf_counter()
        try:
            value=lab.native('model_slot_run',**args)
            status='exact' if value==expected else 'divergent'
        except HTTPError as error:
            status=str(error.code)
        except OSError:
            status='transport_error'
        return time.perf_counter()-started,status

    for concurrent in (1,8,32,64):
        n=max(80,concurrent*4)
        started=time.perf_counter()
        with ThreadPoolExecutor(max_workers=concurrent) as pool:
            observations=list(pool.map(call,range(n)))
        elapsed=time.perf_counter()-started
        latencies=sorted(seconds for seconds,_ in observations)
        p50=latencies[math.ceil(n*.50)-1]
        p95=latencies[math.ceil(n*.95)-1]
        outcomes=dict(Counter(status for _,status in observations))
        stages.append({'concurrent_clients':concurrent,'requests':n,'p50_s':round(p50,4),
                       'p95_s':round(p95,4),'max_s':round(latencies[-1],4),'requests_per_second':round(n/elapsed,2),
                       'outcomes':outcomes,'criterion_met':outcomes=={'exact':n} and p95<=target_p95})
    proof=lab.proof()
    evidence('load',{'scope':'HTTP replay of one previously persisted slot; no production SLO',
                     'exploratory_p95_seconds':target_p95,'stages':stages,
                     'provider_dispatches':len(lab.dispatches()),'reservations':proof['budgets']['model']['reserved'],
                     'paid_model_calls':0})
    assert all(stage['outcomes']=={'exact':stage['requests']} for stage in stages)
    assert proof['budgets']['model']['reserved']==len(lab.dispatches())==1


def test_admission_pressure_during_active_job(lab):
    """Measure the real Aurora HTTP admission limit while a controlled worker stays busy."""
    release=threading.Event()
    worker=lab.state/'wait_worker.py'
    worker.write_text('''import json,sys
from urllib.request import urlopen
config=json.load(sys.stdin)
with urlopen(config['backend']+'/hold',timeout=60) as res:
    res.read()
print(json.dumps({'completed':False}),flush=True)
''',encoding='utf-8')

    class Runtime(BaseHTTPRequestHandler):
        def log_message(self,*args):
            pass

        def reply(self,value):
            self.send_response(200)
            self.end_headers()
            self.wfile.write(json.dumps(value).encode())

        def do_GET(self):
            release.wait(45)
            self.reply({'released':True})

        def do_POST(self):
            action=json.loads(self.rfile.read(int(self.headers['content-length'])))['action']
            if action=='status':
                self.reply({'phase':'ready'})
            else:
                assert action=='worker_config'
                self.reply({'backend':backend})

    class RuntimeServer(ThreadingHTTPServer):
        request_queue_size=128

    server=RuntimeServer(('127.0.0.1',0),Runtime)
    backend='http://127.0.0.1:'+str(server.server_port)
    threading.Thread(target=server.serve_forever,daemon=True).start()
    try:
        _,api=lab.service(['node',str(ROOT/'demo/server.ts')],{
            'state':str(lab.state),'root':str(ROOT),'backend':backend,'token':lab.secret,
            'python':str(PY),'worker':str(worker),'policyModule':(ROOT/'demo-enterprise/policy.ts').as_uri()})

        def admit(_):
            started=time.perf_counter()
            req=Request(api+'/api/jobs',b'{"scenario":"campaign"}',{'content-type':'application/json'})
            try:
                with urlopen(req,timeout=12) as res:
                    return time.perf_counter()-started,res.status,None
            except HTTPError as error:
                return time.perf_counter()-started,error.code,json.load(error).get('error')

        assert admit(0)[1]==201
        started=time.perf_counter()
        with ThreadPoolExecutor(max_workers=64) as pool:
            results=list(pool.map(admit,range(128)))
        elapsed=time.perf_counter()-started
        latencies=sorted(seconds for seconds,_,_ in results)
        with urlopen(api+'/api/state',timeout=5) as response:
            jobs=json.load(response)['jobs']
        assert len(jobs)==1 and jobs[0]['worker_active']
        outcomes=dict(Counter(status for _,status,_ in results))
        reasons=dict(Counter(reason for _,_,reason in results))
        evidence('admission',{'concurrent_clients':64,'requests':128,'outcomes':outcomes,
                             'p95_seconds':round(latencies[math.ceil(len(latencies)*.95)-1],4),'reasons':reasons,
                             'requests_per_second':round(len(results)/elapsed,2),'active_jobs':1,
                             'profile':'Aurora API and process admission with controlled busy worker',
                             'durable_queue_observed':False,'model_calls':0})
        assert outcomes=={409:128} and reasons=={'Aguarde o trabalho em execução':128}
    finally:
        release.set()
        server.shutdown()
        server.server_close()
