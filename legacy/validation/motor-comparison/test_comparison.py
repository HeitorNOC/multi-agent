import concurrent.futures
import hashlib
import json
import os
from pathlib import Path
import queue
import secrets
import sqlite3
import subprocess
import sys
import threading
import time
import uuid
import pytest

ROOT=Path.cwd()
HERE=ROOT/'validation/motor-comparison'
sys.path.insert(0,str(HERE))
sys.path.insert(0,str(ROOT/'vendor/openagents-audit/workspace/backend'))
from protocol import request,Rejected
from tests.conftest import client,db,workspace,setup_database,disable_analytics


class Host:
    def __init__(self,root):
        self.root=root;self.board=secrets.token_hex(32);self.process=None;self.counter=0
        self.results=[];self.start()
    def start(self):
        self.counter+=1
        self.log=open(HERE/f'evidence/service-{self.counter}.log','w',encoding='utf-8')
        self.process=subprocess.Popen([str(ROOT/'poc/.venv/Scripts/python.exe'),'-X','utf8',str(HERE/'service.py')],cwd=ROOT,
            env={**os.environ,'COMPARISON_DATA':str(self.root),'COMPARISON_BOARD_TOKEN':self.board,'PYTHONIOENCODING':'utf-8','LANGSMITH_TRACING':'false','LANGCHAIN_TRACING_V2':'false'},
            stdout=subprocess.PIPE,stderr=self.log,text=True,encoding='utf-8')
        ready=queue.Queue()
        def read():
            for line in self.process.stdout:
                try:
                    data=json.loads(line)
                    if data.get('ready'):ready.put(data);return
                except ValueError:pass
        threading.Thread(target=read,daemon=True).start()
        try:data=ready.get(timeout=45)
        except queue.Empty:self.stop();raise RuntimeError('knowledge/control server startup failed')
        self.url='http://127.0.0.1:'+str(data['port'])
    def stop(self):
        if self.process and self.process.poll() is None:self.process.terminate();self.process.wait(timeout=10)
        self.log.close()
    def board_call(self,path,p):return request(self.url,self.board,path,p)
    def create(self,engine,**extra):
        run=engine+'-'+uuid.uuid4().hex[:12]
        result=self.board_call('/create',{'run':run,'engine':engine,'company':'A','period':run,**extra})
        return {'run':run,'engine':engine,'company':extra.get('company','A'),'token':result['token'],'url':self.url,'checkpoint':str(self.root/(run+'-checkpoint.sqlite'))}
    def call(self,c,path,p=None):return request(self.url,c['token'],path,p)
    def worker(self,c,phase='analyze',wait=True,**extra):
        config={**c,'url':self.url,'phase':phase,**extra}
        python=ROOT/('poc/.venv/Scripts/python.exe' if c['engine']=='langgraph' else 'validation/agentscope/.venv/Scripts/python.exe')
        proc=subprocess.Popen([str(python),'-X','utf8',str(HERE/'worker.py')],cwd=ROOT,stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True,encoding='utf-8')
        started=time.perf_counter();proc.stdin.write(json.dumps(config)+'\n');proc.stdin.close();proc.stdin=None
        if not wait:return proc
        out,err=proc.communicate(timeout=40)
        entry={'run':c['run'],'engine':c['engine'],'phase':phase,'fault':extra,'returncode':proc.returncode,'elapsed_seconds':time.perf_counter()-started,'stdout':out,'stderr':err[-8000:]}
        self.results.append(entry)
        return entry
    def approve(self,c):
        state=self.call(c,'/status');return self.board_call('/approve',{'run':c['run'],'plan':state['plan']})
    def record(self,name,c,**extra):
        value={'scenario':name,'engine':c['engine'],'state':self.call(c,'/status'),**extra}
        # No execution token or human token enters the report.
        with open(HERE/'evidence/scenarios.jsonl','a',encoding='utf-8') as f:f.write(json.dumps(value)+'\n')


@pytest.fixture(scope='module')
def host(tmp_path_factory):
    (HERE/'evidence/scenarios.jsonl').write_text('')
    h=Host(tmp_path_factory.mktemp('motor-comparison'))
    yield h
    h.stop()
    (HERE/'evidence/workers.json').write_text(json.dumps(h.results,indent=2),encoding='utf-8')


@pytest.mark.parametrize('engine',['langgraph','agentscope'])
def test_human_gate_budget_and_trace(host,engine):
    c=host.create(engine)
    result=host.worker(c);assert result['returncode']==0,result
    waiting=host.call(c,'/status');assert waiting['state']=='waiting_approval'
    assert waiting['actual']==2 and waiting['held']==2 and waiting['deliveries']==0
    for finding in waiting['findings'].values():
        assert finding['sources'] and all(s['file_path']=='synthetic-A.md' and s['version']==1 for s in finding['sources'])
    with pytest.raises(Rejected) as denied:host.call(c,'/effect',{'approved':True})
    assert denied.value.code==403
    with pytest.raises(Rejected):host.call(c,'/approve',{'run':c['run'],'plan':waiting['plan']})
    with pytest.raises(Rejected):host.board_call('/approve',{'run':c['run'],'plan':'stale-plan'})
    host.approve(c)
    result=host.worker(c,'act');assert result['returncode']==0,result
    done=host.call(c,'/status');assert done['state']=='completed' and done['deliveries']==1
    assert done['actual']==3 and done['held']==0
    assert done['account']['spent']==3 and done['account']['held']==0
    repeat=host.worker(c,'act');assert repeat['returncode']==0
    assert host.call(c,'/status')['deliveries']==1
    host.record('human_gate_budget_trace',c)


@pytest.mark.parametrize('engine',['langgraph','agentscope'])
def test_abrupt_worker_exit_and_recovery(host,engine):
    c=host.create(engine)
    crashed=host.worker(c,crash_after_sales=True);assert crashed['returncode']==71,crashed
    partial=host.call(c,'/status');assert set(partial['findings'])=={'sales'} and partial['actual']==1
    resumed=host.worker(c);assert resumed['returncode']==0,resumed
    host.approve(c);assert host.worker(c,'act')['returncode']==0
    final=host.call(c,'/status');assert final['actual']==3 and final['deliveries']==1
    requests=[json.loads(e['detail']) for e in final['audit'] if e['event']=='knowledge_request']
    cached=sum(bool(x['cache']) for x in requests)
    assert cached==(1 if engine=='agentscope' else 0)
    host.record('abrupt_worker_recovery',c,knowledge_requests=len(requests),own_finding_cache_hits=cached)


@pytest.mark.parametrize('engine',['langgraph','agentscope'])
def test_cancel_while_retrieval_inflight(host,engine):
    c=host.create(engine,delay=2)
    proc=host.worker(c,wait=False)
    try:
        deadline=time.monotonic()+30
        while time.monotonic()<deadline:
            state=host.call(c,'/status')
            if state['actual']==1:break
            if proc.poll() is not None:raise AssertionError(proc.communicate())
            time.sleep(.04)
        else:raise AssertionError('worker never reached retrieval')
        host.board_call('/cancel',{'run':c['run']})
        proc.terminate();proc.wait(timeout=10)
        assert proc.poll() is not None
        host.board_call('/settle-cancel',{'run':c['run'],'host_observed_worker_exit':True})
        time.sleep(2.2)
        stopped=host.call(c,'/status')
        assert stopped['state']=='cancelled' and stopped['deliveries']==0 and stopped['held']==0 and stopped['actual']==1
        assert stopped['findings']=={}
        with pytest.raises(Rejected):host.call(c,'/effect',{})
        with pytest.raises(Rejected):host.call(c,'/begin',{})
        host.record('cancel_inflight',c,host_observed_worker_exit=True)
    finally:
        if proc.poll() is None:proc.kill();proc.wait(timeout=10)
        proc.communicate(timeout=10)


@pytest.mark.parametrize('engine',['langgraph','agentscope'])
def test_effect_ack_loss_then_control_server_restart(host,engine):
    c=host.create(engine,fault='after_effect')
    assert host.worker(c)['returncode']==0
    host.approve(c)
    failed=host.worker(c,'act');assert failed['returncode']!=0
    uncertain=host.call(c,'/status');assert uncertain['state']=='effect_pending' and uncertain['deliveries']==1
    with pytest.raises(Rejected):host.board_call('/cancel',{'run':c['run']})
    host.stop();host.start()
    recovered=host.worker(c,'act');assert recovered['returncode']==0,recovered
    done=host.call(c,'/status');assert done['state']=='completed' and done['deliveries']==1 and done['actual']==3
    host.record('effect_ack_loss_control_restart',c)


@pytest.mark.parametrize('engine',['langgraph','agentscope'])
def test_identity_scope_revocation_and_overrun(host,engine):
    c=host.create(engine,scopes=[]);host.call(c,'/begin',{})
    with pytest.raises(Rejected):host.call(c,'/knowledge',{'company':'A','capability':'sales'})
    a=host.create(engine);host.call(a,'/begin',{})
    with pytest.raises(Rejected):host.call(a,'/knowledge',{'company':'B','capability':'sales'})
    with pytest.raises(Rejected):request(host.url,'spoofed-token','/status')
    host.board_call('/revoke',{'run':a['run']})
    with pytest.raises(Rejected) as revoked:host.call(a,'/status')
    assert revoked.value.code==401
    over=host.create(engine,fault='cost_overrun',monthly_limit=4);host.call(over,'/begin',{})
    with pytest.raises(Rejected):host.call(over,'/knowledge',{'company':'A','capability':'sales'})
    state=host.call(over,'/status');assert state['state']=='budget_exceeded' and state['actual']==5 and state['account']['spent']==5
    with pytest.raises(Rejected):host.call(over,'/effect',{})
    host.record('provider_overrun_detected_not_prevented',over)


def test_concurrent_aggregate_admission(host):
    period='shared-'+uuid.uuid4().hex
    configs=[host.create('langgraph',period=period,monthly_limit=6),host.create('agentscope',period=period,monthly_limit=6)]
    def start(c):
        try:host.call(c,'/begin',{});return 'admitted'
        except Rejected as error:return error.code
    with concurrent.futures.ThreadPoolExecutor(max_workers=2) as executor:results=list(executor.map(start,configs))
    assert results.count('admitted')==1 and results.count(403)==1
    for c in configs:host.record('aggregate_concurrent_reservation',c,admission_results=results)


@pytest.mark.parametrize('engine',['langgraph','agentscope'])
def test_real_openagents_redelivery_inbox_dedup(host,engine,client,workspace):
    c=host.create(engine);assert host.worker(c)['returncode']==0;host.approve(c);assert host.worker(c,'act')['returncode']==0
    state=host.call(c,'/status');event=json.loads(state['outbox'][0]['payload'])
    for _ in range(2):
        sent=client.post('/v1/events',json={'type':'workspace.message.posted','source':'openagents:agent-alpha','target':'channel/'+workspace['channel']['name'],
            'network':workspace['id'],'payload':{'content':json.dumps(event)},'metadata':{'enterprise_run_id':c['run'],'event_id':event['event_id']}},headers={'X-Workspace-Token':workspace['token']})
        assert sent.status_code==200,sent.text
    polled=client.get('/v1/events',params={'network':workspace['id']},headers={'X-Workspace-Token':workspace['token']})
    rows=[e for e in polled.json()['data']['events'] if e.get('metadata',{}).get('enterprise_run_id')==c['run']]
    assert len(rows)==2
    applied=[]
    for e in rows:applied.append(host.board_call('/consume',{'run':c['run'],'event':json.loads(e['payload']['content'])})['applied'])
    assert applied==[True,False]
    # Durable inbox after a real control-service restart.
    host.stop();host.start()
    assert host.board_call('/consume',{'run':c['run'],'event':event})['applied'] is False
    host.record('openagents_duplicate_delivery_durable_consumer',c,transport_events=2,business_applications=1)


@pytest.mark.parametrize('engine',['langgraph','agentscope'])
def test_provider_model_failure_is_not_completion(host,engine):
    c=host.create(engine)
    failed=host.worker(c,model_failure=True)
    assert failed['returncode']!=0
    partial=host.call(c,'/status')
    assert partial['state']=='running' and partial['actual']==1 and partial['deliveries']==0
    assert partial['approval'] is None and partial['outbox']==[]
    # One explicit host retry, not an unbounded model/delegation loop.
    recovered=host.worker(c);assert recovered['returncode']==0,recovered
    host.approve(c);assert host.worker(c,'act')['returncode']==0
    assert host.call(c,'/status')['actual']==3
    host.record('model_provider_failure_manual_bounded_retry',c,explicit_host_retries=1)


@pytest.mark.parametrize('engine',['langgraph','agentscope'])
def test_business_intent_across_new_runs(host,engine):
    intent='approved-intent-'+uuid.uuid4().hex
    configs=[host.create(engine,intent=intent),host.create(engine,intent=intent)]
    for index,c in enumerate(configs):
        assert host.worker(c)['returncode']==0;host.approve(c);assert host.worker(c,'act')['returncode']==0
        done=host.call(c,'/status')
        assert done['deliveries']==1 and done['actual']==(3 if index==0 else 2)
        host.record('stable_intent_across_new_runs',c,new_run_index=index)
