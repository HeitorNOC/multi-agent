import concurrent.futures
import hashlib
import hmac
import http.cookiejar
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
from pathlib import Path
import secrets
import socket
import sqlite3
import sys
import threading
import time
from urllib.error import HTTPError
from urllib.request import Request, build_opener, HTTPCookieProcessor, urlopen
import uuid

from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
import pytest

HERE=Path(__file__).resolve().parent
ROOT=HERE.parents[1]
sys.path[:0]=[str(ROOT/'validation/langgraph-business-flow'),str(ROOT/'validation/concurrent-reconciliation'),str(ROOT/'demo'),str(ROOT/'demo-enterprise')]
from test_flow import Lab, PY
from authority_client import request
from recovery_bridge import RecoveryBridge, reviewers
from model_gateway import call_model


class NativeLab(Lab):
    def __init__(self, path):
        # Avoid touching the earlier qualification outputs or state directories.
        self.id='aurora-slots-'+uuid.uuid4().hex[:10]
        self.state=path
        self.children, self.logs, self.docker_resources=[],[],[]
        self.brain_key=secrets.token_hex(32)
        self.tokens={actor:secrets.token_hex(24) for actor in ('owner','analyst','board','worker','foreign','reviewer2')}
        self.secret=secrets.token_hex(32)
        self.provider_key=secrets.token_hex(32)
        self.evidence={}
        self.path=path/'model-slots.sqlite'

    def start_authority(self):
        key=Ed25519PrivateKey.generate()
        self.authority, url=self.service([str(PY),str(ROOT/'validation/concurrent-reconciliation/freshness_authority.py')],{
            'path':str(self.state/'authority.sqlite'),'installation':self.id,'secret':self.secret,
            'private_key':key.private_bytes_raw().hex(),'caps':{'model':getattr(self,'model_cap',3),'business':32}})
        self.auth={'freshness_url':url,'freshness_secret':self.secret,
                   'freshness_public':key.public_key().public_bytes_raw().hex(),'installation':self.id}

    def start_native(self, commit_crash=False):
        port=int(self.native_url.rsplit(':',1)[1]) if hasattr(self,'native_url') else 0
        self.process,self.native_url=self.service([str(PY),str(HERE/'fixture_native.py')],{
            **self.auth,'state':str(self.state/'native'),'brain_key':self.brain_key,
            'model_slots_path':str(self.path),'fixture_calls':str(self.state/'dispatches.jsonl'),
            'port':port,'fixture_commit_crash':commit_crash,
            'embedding_key':self.secret,'editorial_key':self.secret,'profile':'enterprise-demo',
            'synthetic_corpus_sha':hashlib.sha256((ROOT/'demo-enterprise/corpus.json').read_bytes()).hexdigest()})

    def native(self, action, **payload):
        raw=json.dumps({'action':action,**payload,'issued':time.time()}).encode()
        sig=hmac.new(bytes.fromhex(self.brain_key),raw,hashlib.sha256).hexdigest()
        with urlopen(Request(self.native_url+'/rpc',raw,{'content-type':'application/json','x-signature':sig}),timeout=10) as response:
            return json.load(response)

    def proof(self):
        return request(self.auth,action='model_slot_list')

    def dispatches(self):
        return [json.loads(line) for line in (self.state/'dispatches.jsonl').read_text().splitlines()]


@pytest.fixture
def lab(tmp_path,monkeypatch):
    for key,value in {'POSTGRES_PASSWORD':'fixture-password','NEO4J_URI':'bolt://127.0.0.1:1',
                      'NEO4J_USERNAME':'fixture','NEO4J_PASSWORD':'fixture-password'}.items():
        monkeypatch.setenv(key,value)
    instance=NativeLab(tmp_path)
    try:
        instance.start_authority()
        instance.start_native()
        yield instance
    finally:
        instance.cleanup()


def test_receipt_replay_divergence_and_budget(lab):
    def call(prompt='Planejamento fictício',slot='plan',job='job-a',limit=1):
        return lab.native('model_slot_run',job=job,slot=slot,prompt=prompt,limit=limit)
    with concurrent.futures.ThreadPoolExecutor(max_workers=5) as pool:
        results=list(pool.map(lambda _:call(),range(5)))
    assert all(value==results[0] for value in results)
    assert len(lab.dispatches())==1 and lab.proof()['budgets']['model']['reserved']==1
    with pytest.raises(HTTPError,match='409'):call('Prompt divergente')
    with pytest.raises(HTTPError,match='409'):call(slot='synthesis')
    # Persisted receipt survives the process and repeated worker calls.
    lab.process.terminate();lab.process.wait(timeout=8);lab.start_native()
    assert call()==results[0] and len(lab.dispatches())==1
    assert lab.native('model_slot_status',job='job-a')['status']=='resumable'
    with sqlite3.connect(lab.path) as db:
        db.execute("UPDATE slots SET result=? WHERE job='job-a'", ('{"text":"forged"}',))
    assert lab.native('model_slot_status',job='job-a')['status']=='receipt_unavailable'
    with pytest.raises(HTTPError,match='409'):call()
    def try_reserve(index):
        try:
            call(job=f'job-candidate-{index}')
            return 200
        except HTTPError as error:
            return error.code
    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
        assert sorted(pool.map(try_reserve,range(4)))==[200,200,409,409]
    assert len(lab.dispatches())==3 and lab.proof()['budgets']['model']['reserved']==3


def test_persisted_receipt_survives_crash_before_authority_commit(lab):
    lab.process.terminate();lab.process.wait(timeout=8);lab.start_native(commit_crash=True)
    original_url=lab.native_url
    args={'job':'job-known','slot':'synthesis','prompt':'Síntese fictícia','limit':2}
    with pytest.raises(OSError):lab.native('model_slot_run',**args)
    assert lab.process.wait(timeout=8)==85
    assert lab.proof()['model_slots'][0]['state']=='admitted'
    lab.start_native()
    assert lab.native_url==original_url
    assert lab.native('model_slot_status',job='job-known')['status']=='resumable'
    assert lab.native('model_slot_run',**args)=={'text':'{"fixture":"resultado sintético"}'}
    proof=lab.proof()
    assert proof['model_slots'][0]['state']=='completed' and proof['model_slots'][0]['receipt_sha']
    assert len(lab.dispatches())==proof['budgets']['model']['reserved']==1


def test_worker_failure_and_two_reviewer_terminal_closure(lab):
    lab.start()
    lab.business.terminate();lab.business.wait(timeout=8)
    lab.config['retained']={'url':lab.auth['freshness_url'],'secret':lab.auth['freshness_secret'],
                            'public':lab.auth['freshness_public'],'scope':'business'}
    lab.config['principals'].append({'id':'reviewer2','role':'board','installation':lab.id,
                                     'sources':['politica-remoto','aquisicao'],'token':lab.tokens['reviewer2']})
    lab.start_business()
    token,bridge_key=secrets.token_hex(32),secrets.token_hex(32)
    accounts=reviewers(lab.state/'reviewers.json',lab.id)
    bridge=RecoveryBridge(lab,model_slots=True)
    agents={agent['id']:agent for agent in json.loads((ROOT/'demo-enterprise/catalog.json').read_text(encoding='utf-8'))['agents']}

    class Handler(BaseHTTPRequestHandler):
        drop_confirm=True

        def log_message(self,*args):pass
        def do_POST(self):
            assert self.headers.get('x-demo-token')==token
            p=json.loads(self.rfile.read(int(self.headers['content-length'])))
            action=p['action']
            status=200
            try:
                if action=='recovery_bridge':
                    assert self.headers.get('x-recovery-bridge-token')==bridge_key
                    value=bridge.call(p)
                    if p['command']['action']=='recovery_confirm' and value['ok'] and Handler.drop_confirm:
                        Handler.drop_confirm=False
                        self.connection.shutdown(socket.SHUT_RDWR)
                        return
                elif action=='status':value={'phase':'ready'}
                elif action=='worker_config':value={'backend':backend,'dsn':lab.dsn}
                elif action=='retrieve':value=[]
                elif action=='llm':
                    req=Request(api+'/internal/model_snapshot',json.dumps({'job':p['job'],'model_lease':p.get('model_lease')}).encode(),
                                {'content-type':'application/json','x-demo-token':token})
                    with urlopen(req,timeout=5) as response:job=json.load(response)
                    value=call_model(lab,job,p['slot'],p['prompt'],agents)
                elif action=='model_job_status':value=lab.native('model_slot_status',job=p['job'])
                else:raise AssertionError('unexpected action')
            except (OSError,ValueError):status=503;value={'error':'provider interrupted'}
            self.send_response(status);self.end_headers();self.wfile.write(json.dumps(value).encode())

    server=ThreadingHTTPServer(('127.0.0.1',0),Handler)
    backend='http://127.0.0.1:'+str(server.server_port)
    threading.Thread(target=server.serve_forever,daemon=True).start()
    try:
        _,api=lab.service(['node',str(ROOT/'demo/server.ts')],{
            'state':str(lab.state),'root':str(ROOT),'installation':lab.id,'token':token,'backend':backend,
            'recoveryBridgeKey':bridge_key,'recoveryReviewers':accounts,'governedModelSlots':True,
            'worker':str(ROOT/'demo-enterprise/worker.py'),'python':str(PY),
            'policyModule':(ROOT/'demo-enterprise/policy.ts').as_uri()})
        def send(path, body=None, client=None):
            req=Request(api+path,None if body is None else json.dumps(body).encode(),{'content-type':'application/json'})
            try:
                with (client.open if client else urlopen)(req,timeout=15) as response:return response.status,json.load(response)
            except HTTPError as error:return error.code,json.load(error)
        def state():return send('/api/state')[1]['jobs'][0]
        code,job=send('/api/jobs',{'scenario':'campaign'});assert code==201
        assert lab.process.wait(timeout=15)==84
        deadline=time.monotonic()+10
        while state()['worker_active'] and time.monotonic()<deadline:time.sleep(.1)
        assert state()['status']=='failed'
        lab.start_native()
        stale=Request(api+'/internal/model_snapshot',json.dumps({'job':job['id'],'model_lease':'stale'}).encode(),
                      {'content-type':'application/json','x-demo-token':token})
        with pytest.raises(HTTPError,match='403'):urlopen(stale,timeout=5)
        assert send('/api/jobs/'+job['id']+'/resume',{})[0]==409
        assert state()['status']=='recovery_required'
        assert send('/api/recovery/cases')[0]==401
        clients=[build_opener(HTTPCookieProcessor(http.cookiejar.CookieJar())) for _ in accounts]
        for client,account in zip(clients,accounts):
            assert send('/api/recovery/session',{'credential':account['credential']},client)[0]==200
        # Reverse alphabetical order to exercise retained vote order.
        second,first=clients
        code,queue=send('/api/recovery/cases',client=first);assert code==200 and len(queue['cases'])==1
        case=queue['cases'][0];assert case['job_id']==job['id'] and case['actionable'] and case['model_slot'].startswith('agent:')
        code,inspection=send('/api/recovery/inspect',{'case_id':case['case_id']},first)
        assert code==200 and 'Interromper antes do recibo' not in json.dumps(inspection)
        base={key:inspection[key] for key in ('case_id','operation_id','evidence_sha')}
        def review(who,action,**fields):
            return send('/api/recovery/'+action,{'request_id':str(uuid.uuid4()),**base,**fields},who)
        reason='Encerrar sem resposta e manter a reserva da tentativa original.'
        assert review(first,'propose',reason=reason,evidence_sha='0'*64)[0]==409
        assert review(first,'propose',reason=reason)[0]==200
        assert review(first,'confirm')[0]==403
        confirm={'request_id':str(uuid.uuid4()),**base}
        assert send('/api/recovery/confirm',confirm,second)[0]==503
        commands=send('/api/recovery/commands',client=second)[1]['commands']
        assert any(command['id']==confirm['request_id'] and command['status']=='unknown' for command in commands)
        assert send('/api/recovery/retry',{'request_id':confirm['request_id']},second)[0]==200
        assert send('/api/recovery/confirm',confirm,second)[1]['replayed']
        assert state()['status']=='closed_unknown'
        assert send('/api/jobs/'+job['id']+'/resume',{})[0]==409
        queue=send('/api/recovery/cases',client=first)[1]
        assert not queue['cases'] and queue['history'][0]['reviewers']==['reviewer2','board']
        with pytest.raises(HTTPError,match='409'):
            lab.native('model_slot_run',job=job['id'],slot='synthesis',prompt='Nova chamada indevida',limit=2)
        proof=lab.proof()
        assert len(lab.dispatches())==proof['budgets']['model']['reserved']==2
        assert {item['state'] for item in proof['model_slots']}=={'completed','closed_unknown'} and len(proof['model_slot_votes'])==2
    finally:
        server.shutdown();server.server_close()
