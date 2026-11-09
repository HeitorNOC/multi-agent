"""Stateful integration: TypeScript business policy + real LangGraph/Postgres.

Models, SSO and semantic retrieval are outside this bounded deterministic test.
"""
import concurrent.futures
import hashlib
import importlib.metadata
import json
import os
from pathlib import Path
import queue
import secrets
import socket
import sqlite3
import subprocess
import threading
import time
import uuid
from urllib.error import HTTPError
from urllib.request import Request, urlopen

import pytest

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
PY = ROOT / 'validation/integrated-pilot/.venv/Scripts/python.exe'
PROVIDER = ROOT / 'validation/integrated-pilot/provider.py'


class Rejected(Exception):
    def __init__(self, status, body):
        super().__init__(f'{status}: {body}')
        self.status = status


def request(url, token, payload):
    req = Request(url+'/rpc',json.dumps(payload).encode(),{'content-type':'application/json','authorization':'Bearer '+token})
    try:
        with urlopen(req,timeout=15) as response:
            return json.load(response)
    except HTTPError as error:
        raise Rejected(error.code,error.read().decode()) from error


class Lab:
    def __init__(self):
        self.id = 'business-flow-'+uuid.uuid4().hex[:10]
        self.state = HERE/'.state'/self.id
        self.state.mkdir(parents=True)
        self.children, self.logs, self.docker_resources = [], [], []
        self.secret, self.provider_key = secrets.token_hex(24), secrets.token_hex(32)
        self.tokens = {name:secrets.token_hex(24) for name in ['owner','analyst','board','worker','foreign']}
        self.evidence = {'installation':self.id,'checkpoints':[],'worker_calls':[],'model_calls':0,'production_approved':False,
                         'scope':'deterministic capability policy, synthetic auth, canonical snapshots, synthetic provider'}

    def redact(self,text):
        for value in [self.secret,self.provider_key,*self.tokens.values()]:
            text = text.replace(value,'[redacted]')
        return text

    def docker(self,*args,input=None,check=True):
        result = subprocess.run(['docker',*args],input=input,capture_output=True,timeout=50)
        if check and result.returncode:
            raise RuntimeError(self.redact(result.stderr.decode(errors='replace'))[-2500:])
        return result

    def service(self,args,config):
        log = (self.state/f'service-{len(self.logs)}.log').open('a',encoding='utf-8')
        self.logs.append(log)
        proc = subprocess.Popen(args,stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=log,text=True,encoding='utf-8',cwd=ROOT,
                                env={**os.environ,'LANGSMITH_TRACING':'false','LANGCHAIN_TRACING_V2':'false','PYTHONIOENCODING':'utf-8'})
        self.children.append(proc)
        proc.stdin.write(json.dumps(config)+'\n'); proc.stdin.close()
        lines = queue.Queue()
        def read():
            for line in proc.stdout:
                try:
                    value = json.loads(line)
                    if value.get('ready'):
                        lines.put(value); return
                except ValueError:
                    continue
        threading.Thread(target=read,daemon=True).start()
        try:
            message = lines.get(timeout=25)
        except queue.Empty:
            raise RuntimeError('service readiness deadline; see private service logs')
        return proc,'http://127.0.0.1:'+str(message['port'])

    def editorial(self,actor,payload):
        config = {'db':str(self.state/'canonical.sqlite'),'vault':str(self.state/'vault'),
                  'installation':self.id,'key':self.secret,'actor':actor}
        result = subprocess.run(['node',str(ROOT/'validation/temporal-editorial/editorial.ts')],
                                input=json.dumps({'config':config,'payload':payload}),capture_output=True,text=True,encoding='utf-8',cwd=ROOT,timeout=15)
        if result.returncode:
            raise RuntimeError(self.redact(result.stderr))
        return json.loads(result.stdout)

    def start(self):
        requested_image=getattr(self,'postgres_image','postgres:17.6-bookworm')
        image = json.loads(self.docker('image','inspect',requested_image).stdout)[0]
        self.image = requested_image if '@sha256:' in requested_image else next(d for d in image['RepoDigests'] if d.startswith('postgres@sha256:'))
        self.evidence['postgres_image'] = self.image
        self.container = self.id+'-pg'; self.volume = self.id+'-pg-data'
        with socket.socket() as sock:
            sock.bind(('127.0.0.1',0)); self.port = sock.getsockname()[1]
        self.docker('volume','create','--label','qualification='+self.id,self.volume)
        self.docker_resources.append(('volume',self.volume))
        self.docker('run','-d','--name',self.container,'--label','qualification='+self.id,'--user','postgres',
                    '--cap-drop','ALL','--security-opt','no-new-privileges=true','--memory','512m','--cpus','1','--pids-limit','128',
                    '-e','POSTGRES_PASSWORD='+self.secret,'--mount',f'type=volume,src={self.volume},dst=/var/lib/postgresql/data',
                    '-p',f'127.0.0.1:{self.port}:5432',self.image)
        self.docker_resources.append(('container',self.container))
        deadline = time.monotonic()+45
        while self.docker('exec',self.container,'pg_isready','-h','127.0.0.1','-U','postgres',check=False).returncode:
            if time.monotonic() > deadline:
                raise RuntimeError('PostgreSQL startup timeout')
            time.sleep(.2)
        sql = f"CREATE ROLE workflow_runtime LOGIN NOSUPERUSER NOBYPASSRLS PASSWORD '{self.secret}'; CREATE SCHEMA runtime AUTHORIZATION workflow_runtime;"
        self.docker('exec','-i',self.container,'psql','-Xq','-v','ON_ERROR_STOP=1','-U','postgres',input=sql.encode())
        self.dsn = f'postgresql://workflow_runtime:{self.secret}@127.0.0.1:{self.port}/postgres?options=-csearch_path%3Druntime&connect_timeout=5'
        vault = self.state/'vault'; vault.mkdir()
        for source,domain,body in [('politica-remoto','publico','Trabalho remoto autorizado por dois dias por semana.'),
                                   ('aquisicao','financeiro','Limite sintético de aquisição: 1000 unidades. SIGILO_FIXTURE_FINANCEIRO')]:
            name = source+'.md'
            (vault/name).write_text(f'---\nsource: {source}\nversion: 1\nvalid_at: 2026-01-01T00:00:00Z\ndomain: {domain}\n---\n{body}\n',encoding='utf-8')
            draft = self.editorial({'id':'owner','role':'finance'},{'action':'submit','path':name})
            self.editorial({'id':'board','role':'board'},{'action':'review','id':draft['id'],'raw_sha':draft['raw_sha']})
            self.editorial({'id':'board','role':'board'},{'action':'commit','id':draft['id'],
                           'receipt':{'fixture':'canonical-only; no graph projection in this experiment'}})
        self.provider_proc,self.provider_url = self.service([str(PY),str(PROVIDER)],{'path':str(self.state/'provider.sqlite'),'secret':self.provider_key})
        principals = []
        for name,role,installation,sources in [
            ('owner','finance',self.id,['politica-remoto','aquisicao']),('analyst','analyst',self.id,['politica-remoto']),
            ('board','board',self.id,['politica-remoto','aquisicao']),('worker','worker',self.id,[]),
            ('foreign','finance','different-installation',['politica-remoto','aquisicao'])]:
            principals.append({'id':name,'role':role,'installation':installation,'sources':sources,'token':self.tokens[name]})
        self.config = {'installation':self.id,'db':str(self.state/'business.sqlite'),'editorial':str(self.state/'canonical.sqlite'),
                       'vault':str(vault),'editorialKey':self.secret,'principals':principals,'budget':64,
                       'provider':self.provider_url,'providerKey':self.provider_key,'leaseMs':60000}
        self.start_business()
        self.evidence['versions'] = {p:importlib.metadata.version(p) for p in ['langgraph','langgraph-checkpoint','langgraph-checkpoint-postgres','psycopg','pytest']}
        self.evidence['source_sha'] = subprocess.run(['git','-C',str(ROOT/'vendor/langgraph'),'rev-parse','HEAD'],capture_output=True,text=True).stdout.strip()

    def start_business(self):
        self.business,self.api = self.service(['node',str(HERE/'business.ts')],self.config)

    def call(self,actor,action,**payload):
        return request(self.api,self.tokens[actor],{'action':action,**payload})

    def new(self,capabilities=None,execute=True,maxUnits=4):
        return self.call('owner','create',capabilities=capabilities or ['policy_lookup','finance_review'],execute=execute,maxUnits=maxUnits)

    def run_worker(self,job,resume=False,crash=False,expected=0):
        config = {'api':self.api,'token':self.tokens['worker'],'job':job,'installation':self.id,'dsn':self.dsn,
                  'resume':resume,'crash_after_effect':crash}
        result = subprocess.run([str(PY),str(HERE/'worker.py')],input=json.dumps(config),capture_output=True,text=True,encoding='utf-8',cwd=ROOT,
                                timeout=35,env={**os.environ,'LANGSMITH_TRACING':'false','LANGCHAIN_TRACING_V2':'false','PYTHONIOENCODING':'utf-8'})
        self.evidence['worker_calls'].append({'job':job,'resume':resume,'crash':crash,'exit_code':result.returncode,
                                             'stdout':result.stdout,'stderr':self.redact(result.stderr)[-5000:]})
        if expected == 0:
            assert result.returncode == 0,self.redact(result.stderr)[-5000:]
            return json.loads(result.stdout)
        assert result.returncode != 0,'expected worker failure'
        if expected > 0:
            assert result.returncode == expected,self.redact(result.stderr)[-1500:]
        return result.returncode

    def fence(self,job):
        return self.call('board','fence',job=job,reason='Qualification: prior worker terminated or deliberately fenced; effect reconciliation required')

    def mark(self,name,**details):
        self.evidence['checkpoints'].append({'name':name,**details})
        print('CHECKPOINT '+name,flush=True)
        self.save()

    def save(self):
        path = HERE/'evidence'; path.mkdir(exist_ok=True)
        (path/'results.json').write_text(json.dumps(self.evidence,indent=2,ensure_ascii=False),encoding='utf-8')

    def cleanup(self):
        for proc in reversed(self.children):
            if proc.poll() is None:
                proc.terminate(); proc.wait(timeout=8)
        for log in self.logs:
            log.close()
        for kind,name in reversed(self.docker_resources):
            inspect = self.docker(*(('inspect',name) if kind == 'container' else ('volume','inspect',name)),check=False)
            if inspect.returncode:
                continue
            value = json.loads(inspect.stdout)[0]
            labels = value.get('Config',{}).get('Labels',{}) if kind == 'container' else value.get('Labels',{})
            assert labels.get('qualification') == self.id,'cleanup ownership mismatch'
            self.docker(*(('rm','-f',name) if kind == 'container' else ('volume','rm',name)))


def test_business_flow_and_crash_recovery():
    lab = Lab(); started = time.perf_counter()
    def denied(fn,status):
        with pytest.raises(Rejected) as error:
            fn()
        assert error.value.status == status,str(error.value)
    try:
        lab.start(); lab.mark('isolated_postgres_and_typescript_canonical_ready',versions=lab.evidence['versions'])
        denied(lambda:request(lab.api,'forged',{'action':'state'}),401)
        denied(lambda:lab.call('foreign','create',capabilities=['policy_lookup'],execute=False,maxUnits=1),403)
        denied(lambda:lab.call('analyst','create',capabilities=['finance_review'],execute=False,maxUnits=1),403)
        denied(lambda:lab.call('owner','create',capabilities=['unknown'],execute=False,maxUnits=1),400)
        denied(lambda:lab.call('owner','create',capabilities=['policy_lookup'],execute=False,maxUnits=1,owner='board'),400)
        small = lab.new(['policy_lookup'],execute=False,maxUnits=1)
        assert small['plan']['strategy'] == 'A1'
        result = lab.run_worker(small['id'])
        assert result['completed'] and result['evidence_count'] == 1
        lab.mark('simple_route_no_unnecessary_team_and_tenant_acl_denials')

        single_write = lab.new(['policy_lookup'],execute=True,maxUnits=3)
        assert single_write['plan']['strategy'] == 'A2'
        assert lab.run_worker(single_write['id'])['next'] == ['approval']
        denied(lambda:lab.call('owner','approve',job=single_write['id'],hash=single_write['hash']),403)
        denied(lambda:lab.call('board','approve',job=single_write['id'],hash='altered'),409)
        # Resume signal alone must not authorize the effect.
        lab.run_worker(single_write['id'],resume=True,expected=-1)
        assert not lab.call('board','state')['effects']
        lab.fence(single_write['id'])
        lab.call('board','approve',job=single_write['id'],hash=single_write['hash'])
        assert lab.run_worker(single_write['id'],resume=True)['completed']
        lab.mark('exact_plan_approval_and_resume_without_authorization_denied')

        team = lab.new()
        waiting = lab.run_worker(team['id'])
        assert team['plan']['strategy'] == 'A3' and waiting['evidence_count'] == 2 and waiting['next'] == ['approval']
        assert len(lab.call('board','state')['effects']) == 1
        lab.call('board','approve',job=team['id'],hash=team['hash'])
        assert lab.run_worker(team['id'],resume=True,crash=True,expected=73) == 73
        lab.fence(team['id'])
        assert lab.run_worker(team['id'],resume=True)['completed']
        original = lab.call('owner','status',job=team['id'])['result']
        assert original['receipt']['deliveries'] == 1
        lab.mark('dynamic_team_worker_crash_after_effect_before_checkpoint_recovered',sources=len(original['evidence']))

        api_crash = lab.new()
        assert lab.run_worker(api_crash['id'])['next'] == ['approval']
        lab.call('board','approve',job=api_crash['id'],hash=api_crash['hash'])
        lab.call('board','fault')
        lab.run_worker(api_crash['id'],resume=True,expected=-1)
        assert lab.business.wait(timeout=8) == 74
        lab.start_business()
        lab.fence(api_crash['id'])
        assert lab.run_worker(api_crash['id'],resume=True)['completed']
        assert lab.call('owner','status',job=team['id'])['result'] == original
        lab.mark('business_process_crash_after_provider_before_receipt_reconciled',historical_result_unchanged=True)

        # Second OS process, same business ledger: no in-memory global mutex.
        second_business,second_api = lab.service(['node',str(HERE/'business.ts')],lab.config)

        lease_job = lab.new(['policy_lookup'],execute=False,maxUnits=1)
        first = lab.call('worker','claim',job=lease_job['id'],worker='manual-worker-1')
        denied(lambda:request(second_api,lab.tokens['worker'],{'action':'claim','job':lease_job['id'],'worker':'manual-worker-2'}),409)
        lab.fence(lease_job['id'])
        second = lab.call('worker','claim',job=lease_job['id'],worker='manual-worker-2')
        denied(lambda:lab.call('worker','read',job=lease_job['id'],worker='manual-worker-1',epoch=first['epoch'],capability='policy_lookup'),409)
        denied(lambda:request(second_api,lab.tokens['worker'],{'action':'effect','job':lease_job['id'],'worker':'manual-worker-1','epoch':first['epoch']}),409)
        denied(lambda:lab.call('worker','effect',job=lease_job['id'],worker='manual-worker-2',epoch=second['epoch'],target='unapproved'),400)
        lab.call('worker','release',job=lease_job['id'],worker='manual-worker-2',epoch=second['epoch'])
        assert lab.run_worker(lease_job['id'])['completed']
        lab.mark('exclusive_job_lease_stale_fencing_and_payload_tamper_denied')

        revoked = lab.new()
        lab.run_worker(revoked['id'])
        lab.call('board','approve',job=revoked['id'],hash=revoked['hash'])
        before = lab.call('board','state')
        lab.call('board','revoke',principal='owner',source='aquisicao')
        lab.run_worker(revoked['id'],resume=True,expected=-1)
        denied(lambda:lab.call('owner','status',job=team['id']),403)
        assert len(lab.call('board','state')['effects']) == len(before['effects'])
        lab.mark('current_acl_blocks_approved_dispatch_and_historical_delivery')

        denied(lambda:lab.new(['policy_lookup'],execute=True,maxUnits=2),429)
        baseline = lab.call('board','state')
        accounted = sum(j['spent'] if j['state']=='completed' else j['reserved'] for j in baseline['jobs'])
        expected = (64-accounted)//3
        def admit(index):
            try:
                api = lab.api if index%2 == 0 else second_api
                created = request(api,lab.tokens['owner'],{'action':'create','capabilities':['policy_lookup'],'execute':True,'maxUnits':3})
                return {'accepted':True,'id':created['id']}
            except Rejected as error:
                    return {'accepted':False,'status':error.status,'error':str(error)}
        with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool:
            attempts = list(pool.map(admit,range(24)))
        lab.evidence['quota_attempts'] = attempts
        assert sum(x['accepted'] for x in attempts) == expected
        assert all(x['accepted'] or x['status']==429 for x in attempts)
        lab.mark('concurrent_whole_job_reservations_respect_installation_ceiling',attempts=24,admitted=expected,business_processes=2)

        state = lab.call('board','state')
        for completed in [small,single_write,team,api_crash,lease_job]:
            row = next(x for x in state['jobs'] if x['id']==completed['id'])
            assert row['state']=='completed' and row['spent']==row['reserved']
            steps = [x for x in state['charges'] if x['job']==completed['id']]
            assert sum(x['units'] for x in steps)==row['spent']
        with sqlite3.connect(lab.state/'provider.sqlite') as provider:
            receipts = provider.execute('SELECT key,digest,run FROM receipts').fetchall()
            sends = provider.execute("SELECT key,count(*) FROM requests WHERE action='send' GROUP BY key").fetchall()
        assert len(receipts)==3 and len(sends)==3 and all(n==1 for _,n in sends)
        lab.evidence['provider'] = {'unique_receipts':len(receipts),'send_counts':dict(sends)}
        lab.evidence['business_state'] = state
        lab.evidence['result'] = 'PASS_BOUNDED_INTEGRATION'
        lab.mark('single_external_effect_and_single_charges_across_process_restarts',receipts=3)
    except BaseException as error:
        lab.evidence['result'] = 'FAIL'
        lab.evidence['error'] = lab.redact(repr(error))
        raise
    finally:
        lab.evidence['seconds'] = time.perf_counter()-started
        try:
            lab.cleanup(); lab.evidence['disposable_resources_removed'] = True
        finally:
            lab.save()
