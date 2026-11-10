"""Native semantic release, signed backup witness and cold restoration integration."""
import hashlib
import hmac
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
from urllib.request import Request,urlopen

import pytest
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

HERE=Path(__file__).resolve().parent;ROOT=HERE.parents[1]
sys.path.insert(0,str(ROOT/'validation/langgraph-retained-flow'))
from test_signed_flow import SignedLab,Rejected,PY
from authority_client import request as signed_request
from freshness_authority import dump,sha

PG='pgvector/pgvector@sha256:c0cd736fe8b8b5d408db56b780570bac404fe518e66e39de624aa46f9aabc60a'
NEO='neo4j@sha256:fe8607113c4177fbd2466bf2c30f1ebab5b9530594e86487c58c98e113145192'


class BrainLab(SignedLab):
    def __init__(self):
        super().__init__();self.state=HERE/'.state'/self.id;self.state.mkdir(parents=True);self.evidence_dir=Path(os.environ.get('QUALIFICATION_EVIDENCE_DIR',str(HERE/'evidence')))
        self.postgres_image=PG;self.brain_key=secrets.token_hex(32);self.embedding_key=secrets.token_hex(32);self.kek=AESGCM.generate_key(bit_length=256)
        self.native_state=self.state/'native';self.native_process=None;self.evidence['scope']='native LightRAG/ONNX projection and canonical recovery, deterministic coordination'

    def redact(self,text):
        for value in [self.brain_key,self.embedding_key,getattr(self,'authority_secret','')]:
            if value:text=text.replace(value,'[redacted]')
        return super().redact(text)

    def editorial(self,actor,payload):
        if payload['action']=='submit':
            note=self.state/'vault'/payload['path']
            content=note.read_text(encoding='utf-8')
            content=content.replace('Trabalho remoto autorizado por dois dias por semana.','A empresa ACME adota a Política Remoto. A Política Remoto autoriza os funcionários da ACME a trabalhar remotamente dois dias por semana.')
            content=content.replace('Limite sintético de aquisição: 1000 unidades.','A empresa ACME adota a Política de Aquisição. A Política de Aquisição limita compras da ACME a 1000 unidades monetárias por pedido. Código interno:')
            note.write_text(content,encoding='utf-8')
        return super().editorial(actor,payload)

    def start(self):
        super().start();self.stop_businesses()
        self.config['leaseMs']=900000
        key=Ed25519PrivateKey.generate();self.public=key.public_key().public_bytes_raw().hex();self.authority_secret=secrets.token_hex(32)
        self.authority_config={'path':str(self.state/'retained-outside-backup.sqlite'),'installation':self.id,'private_key':key.private_bytes_raw().hex(),
            'secret':self.authority_secret,'caps':{'business':64,'model':16},'evidence':str(self.state/'signed-proofs.jsonl')}
        self.authority();self.config['retained'].update(commitLeaseMs=900000,commitWaitMs=330000)
        self.evidence_dir.mkdir(exist_ok=True)
        (self.evidence_dir/'authority-public.json').write_text(json.dumps({'installation':self.id,'public':self.public}),encoding='utf-8')
        sql=f"CREATE ROLE knowledge_owner LOGIN NOSUPERUSER NOBYPASSRLS PASSWORD '{self.secret}'; CREATE DATABASE knowledge OWNER knowledge_owner;"
        self.docker('exec','-i',self.container,'psql','-Xq','-v','ON_ERROR_STOP=1','-U','postgres',input=sql.encode())
        self.docker('exec','-i',self.container,'psql','-Xq','-v','ON_ERROR_STOP=1','-U','postgres','-d','knowledge',input=b'CREATE EXTENSION vector;')
        self.start_neo()
        embedding_py=ROOT/'validation/decision-qualification/.embedding-venv/Scripts/python.exe'
        self.embedding_process,self.embedding_url=self.service([str(embedding_py),str(ROOT/'validation/concurrent-reconciliation/embedding_server.py')],
            {'secret':self.embedding_key,'weights':str(ROOT/'validation/decision-qualification/.models/faf4aa4225822f3bc6376869cb1164e8e3feedd0'),
             'evidence':str(self.state/'embedding-calls.jsonl'),**getattr(self,'embedding_options',{})})
        self.start_native();self.config['brain']={'url':self.native_url,'key':self.brain_key}
        if os.environ.get('BRAIN_DETACHED_PROFILE')=='1':self.config['detachedInference']=True
        self.start_business()

    def start_neo(self,volume=None):
        self.neo_name=self.id+'-neo-'+uuid.uuid4().hex[:6]
        if not volume:
            volume=self.neo_name+'-data';self.docker('volume','create','--label','qualification='+self.id,volume);self.docker_resources.append(('volume',volume))
        self.neo_volume=volume
        with socket.socket() as sock:sock.bind(('127.0.0.1',0));self.neo_port=sock.getsockname()[1]
        self.docker('run','-d','--name',self.neo_name,'--label','qualification='+self.id,'--user','neo4j','--cap-drop','ALL',
            '--security-opt','no-new-privileges=true','--memory','1g','--cpus','1','--pids-limit','256',
            '-e','NEO4J_AUTH=neo4j/'+self.secret,'-e','NEO4J_dbms_usage__report_enabled=false',
            '-e','NEO4J_server_memory_heap_initial__size=256m','-e','NEO4J_server_memory_heap_max__size=256m','-e','NEO4J_server_memory_pagecache_size=128m',
            '--mount',f'type=volume,src={volume},dst=/data','-p',f'127.0.0.1:{self.neo_port}:7687',NEO)
        self.docker_resources.append(('container',self.neo_name))
        self.wait_neo()

    def wait_neo(self):
        deadline=time.monotonic()+80
        while self.docker('exec',self.neo_name,'cypher-shell','-u','neo4j','-p',self.secret,'RETURN 1',check=False).returncode:
            if time.monotonic()>deadline:raise RuntimeError('Neo4j readiness deadline')
            time.sleep(.3)

    def native(self,action,**payload):
        raw=json.dumps({'action':action,**payload,'issued':time.time()}).encode()
        sig=hmac.new(bytes.fromhex(self.brain_key),raw,hashlib.sha256).hexdigest()
        with urlopen(Request(self.native_url+'/rpc',raw,{'content-type':'application/json','x-signature':sig}),timeout=360) as response:return json.load(response)

    def start_native(self):
        model=self.state/'model';model.mkdir(exist_ok=True)
        shutil.copy2(ROOT/'validation/concurrent-reconciliation/provider.schema.json',self.state/'provider.schema.json')
        cwd=self.state/'model-io';cwd.mkdir(exist_ok=True)
        config={'state':str(self.native_state),'installation':self.id,'editorial_key':self.config['editorialKey'],'brain_key':self.brain_key,
            'embedding_key':self.embedding_key,'embedding_url':self.embedding_url,'model_budget':str(self.state/'unused-model-budget.json'),
            'evidence':str(model),'model_cwd':str(cwd),'model_name':'gpt-6.1-terra','instance':uuid.uuid4().hex,**self.authority_client}
        config['synthetic_corpus_sha']=hashlib.sha256((HERE/'corpus.json').read_bytes()).hexdigest()
        config.update(getattr(self,'native_options',{}))
        # Service env only; the provider's own allowlist strips these from model subprocesses.
        env={'POSTGRES_HOST':'127.0.0.1','POSTGRES_PORT':str(self.port),'POSTGRES_USER':'knowledge_owner','POSTGRES_PASSWORD':self.secret,'POSTGRES_DATABASE':'knowledge',
             'POSTGRES_MAX_CONNECTIONS':'5','POSTGRES_WORKSPACE':'','NEO4J_WORKSPACE':'','NEO4J_URI':f'bolt://127.0.0.1:{self.neo_port}',
             'NEO4J_USERNAME':'neo4j','NEO4J_PASSWORD':self.secret,'NEO4J_DATABASE':'neo4j','NEO4J_MAX_CONNECTION_POOL_SIZE':'5'}
        previous={k:os.environ.get(k) for k in env};os.environ.update(env)
        try:self.native_process,self.native_url=self.service([str(PY),str(HERE/'native.py')],config)
        finally:
            for k,v in previous.items():
                if v is None:os.environ.pop(k,None)
                else:os.environ[k]=v
        if 'brain' in self.config:self.config['brain']['url']=self.native_url

    def stop_native(self):
        if self.native_process and self.native_process.poll() is None:
            self.native('shutdown');self.native_process.wait(timeout=15)

    def publish(self,draft,crash=False):
        release=self.call('board','brain_prepare',id=draft)
        config={'release':release,'api':self.api,'worker_token':self.tokens['worker'],'brain_url':self.native_url,'brain_key':self.brain_key,
                'dsn':self.dsn,'installation':self.id,'crash_after_stage':crash}
        result=subprocess.run([str(PY),str(HERE/'publication_worker.py')],input=json.dumps(config),capture_output=True,text=True,encoding='utf-8',cwd=ROOT,timeout=700,
            env={**os.environ,'LANGSMITH_TRACING':'false','LANGCHAIN_TRACING_V2':'false'})
        self.evidence.setdefault('publication_calls',[]).append({'draft':draft,'crash':crash,'exit_code':result.returncode,'stdout':result.stdout,'stderr':self.redact(result.stderr)[-6000:]})
        assert result.returncode==(79 if crash else 0),self.redact(result.stderr)[-4000:]
        return None if crash else json.loads(result.stdout)

    def run_worker(self,job,resume=False,**kwargs):
        config={'api':self.api,'token':self.tokens['worker'],'job':job,'installation':self.id,'dsn':self.dsn,'resume':resume,'request_timeout':330}
        result=subprocess.run([str(PY),str(ROOT/'validation/langgraph-business-flow/worker.py')],input=json.dumps(config),capture_output=True,text=True,encoding='utf-8',cwd=ROOT,
            timeout=800,env={**os.environ,'LANGSMITH_TRACING':'false','LANGCHAIN_TRACING_V2':'false'})
        self.evidence['worker_calls'].append({'job':job,'exit_code':result.returncode,'stdout':result.stdout,'stderr':self.redact(result.stderr)[-5000:]})
        assert result.returncode==0,self.redact(result.stderr)[-4000:]
        return json.loads(result.stdout)

    def neo_archive(self,bundle,action,volume):
        self.docker('run','--rm','--name',self.id+'-neo-helper-'+uuid.uuid4().hex[:6],'--label','qualification='+self.id,
            '--network','none','--user','neo4j','--memory','768m','--cpus','1','--pids-limit','256',
            '--mount',f'type=volume,src={volume},dst=/data','--mount',f'type=bind,src={bundle.resolve()},dst=/backup',
            '--entrypoint','neo4j-admin',NEO,'database',action,'neo4j',
            *(['--to-path=/backup','--overwrite-destination=true'] if action=='dump' else ['--from-path=/backup','--overwrite-destination=true']))

    def backup_brain(self,name):
        snapshot=self.call('board','brain_checkpoint',request_id=str(uuid.uuid4()))
        self.stop_businesses();self.stop_native()
        bundle=super().backup(name)
        with sqlite3.connect(self.native_state/'native.sqlite') as original,sqlite3.connect(bundle/'native.sqlite') as copy:original.backup(copy)
        if (self.native_state/'rag').exists():shutil.copytree(self.native_state/'rag',bundle/'rag')
        (bundle/'knowledge.dump').write_bytes(self.docker('exec',self.container,'pg_dump','-U','postgres','-Fc','knowledge').stdout)
        self.docker('stop',self.neo_name);self.neo_archive(bundle,'dump',self.neo_volume)
        keys=json.dumps({'editorial':self.config['editorialKey'],'brain':self.brain_key,'embedding':self.embedding_key,'provider':self.provider_key}).encode()
        nonce=secrets.token_bytes(12);(bundle/'keys.enc').write_bytes(nonce+AESGCM(self.kek).encrypt(nonce,keys,self.id.encode()))
        files={p.relative_to(bundle).as_posix():hashlib.sha256(p.read_bytes()).hexdigest() for p in bundle.rglob('*') if p.is_file() and p.name not in ['manifest.json','backup-manifest.json']}
        manifest={'installation':self.id,'id':name,'files':files,'native_snapshot':snapshot['sha']}
        (bundle/'manifest.json').write_text(dump(manifest),encoding='utf-8')
        self.docker('start',self.neo_name);self.wait_neo();self.start_native();self.start_business()
        proof=self.call('board','retained_bind_backup',id=name,manifest_sha=sha(manifest),snapshot_sha=snapshot['sha'])
        assert next(b for b in proof['backups'] if b['id']==name)['manifest_sha']==sha(manifest)
        return bundle

    def verify_bundle(self,bundle):
        manifest=json.loads((bundle/'manifest.json').read_text(encoding='utf-8'))
        proof=signed_request(self.authority_client,action='proof')
        witness=next(b for b in proof['backups'] if b['id']==manifest['id'])
        if witness['manifest_sha']!=sha(manifest) or witness['head']!=proof['head']:raise ValueError('backup witness stale or tampered')
        for name,digest in manifest['files'].items():
            path=(bundle/name).resolve()
            if not path.is_relative_to(bundle.resolve()) or hashlib.sha256(path.read_bytes()).hexdigest()!=digest:raise ValueError('bundle file invalid')
        envelope=(bundle/'keys.enc').read_bytes()
        keys=json.loads(AESGCM(self.kek).decrypt(envelope[:12],envelope[12:],self.id.encode()))
        return manifest,keys

    def restore_brain(self,bundle):
        manifest,keys=self.verify_bundle(bundle)  # before stopping/changing live services
        self.stop_businesses();self.stop_native()
        self.brain_key=keys['brain'];self.embedding_key=keys['embedding'];self.config['editorialKey']=keys['editorial'];self.provider_key=keys['provider']
        self.restore_postgres(bundle/'runtime.dump')
        sql=f"CREATE ROLE knowledge_owner LOGIN NOSUPERUSER NOBYPASSRLS PASSWORD '{self.secret}'; CREATE DATABASE knowledge OWNER knowledge_owner;"
        self.docker('exec','-i',self.container,'psql','-Xq','-v','ON_ERROR_STOP=1','-U','postgres',input=sql.encode())
        self.docker('exec','-i',self.container,'pg_restore','-U','postgres','-d','knowledge','--exit-on-error',input=(bundle/'knowledge.dump').read_bytes())
        volume=self.id+'-restored-neo-'+uuid.uuid4().hex[:6];self.docker('volume','create','--label','qualification='+self.id,volume);self.docker_resources.append(('volume',volume))
        self.neo_archive(bundle,'load',volume);self.start_neo(volume)
        target=self.state/('restored-brain-'+uuid.uuid4().hex[:6]);target.mkdir()
        for name in ['business.sqlite','canonical.sqlite','native.sqlite']:shutil.copy2(bundle/name,target/name)
        shutil.copytree(bundle/'vault',target/'vault')
        if (bundle/'rag').exists():shutil.copytree(bundle/'rag',target/'rag')
        self.native_state=target;self.config.update(db=str(target/'business.sqlite'),editorial=str(target/'canonical.sqlite'),vault=str(target/'vault'))
        self.config['brain']['key']=self.brain_key;self.start_native();self.start_business()

    def save(self):
        self.evidence_dir.mkdir(exist_ok=True)
        for kind,path in [('model',self.state/'model/model-calls.jsonl'),('embedding',self.state/'embedding-calls.jsonl')]:
            if path.exists():
                rows=[json.loads(line) for line in path.read_text(encoding='utf-8').splitlines()]
                if kind=='model':self.evidence['model_usage_records']=rows;self.evidence['model_calls']=len(rows)
                else:self.evidence[kind+'_calls']=rows
        (self.evidence_dir/'results.json').write_text(json.dumps(self.evidence,indent=2,ensure_ascii=False),encoding='utf-8')


def test_native_brain_release_and_joint_restore():
    lab=BrainLab();started=time.perf_counter()
    def denied(fn,status):
        with pytest.raises(Rejected) as error:fn()
        assert error.value.status==status,str(error.value)
    try:
        lab.start()
        denied(lambda:lab.new_signed(['policy_lookup'],execute=False,maxUnits=1),503)
        # Missing projection is rejected before a retained intent/model admission.
        # If a failed quote created no journal entry, bootstrap remains coherent.
        assert lab.call('board','retained_status')['current']
        with sqlite3.connect(lab.config['editorial']) as db:
            drafts={s:d for s,d in db.execute('SELECT source,draft FROM canonical')}
        for draft in drafts.values():lab.publish(draft)
        first=lab.new_signed(execute=False,maxUnits=2);assert lab.run_worker(first['id'])['completed']
        original=lab.call('owner','status',job=first['id'])['result']
        by_source={e['snapshot']['source']:e['snapshot'] for e in original['evidence']}
        assert 'dois' in by_source['politica-remoto']['semantic']['answer'].lower() or '2' in by_source['politica-remoto']['semantic']['answer']
        assert '1000' in by_source['aquisicao']['semantic']['answer'].replace('.','').replace(',','')
        assert all(s['semantic']['native'] for s in by_source.values())
        assert all(s['semantic']['projection']['inventory']['nodes']>0 and s['semantic']['projection']['inventory']['edges']>0 for s in by_source.values())
        lab.mark('native_extraction_vectors_graph_and_advice_through_typescript_langgraph')
        old=lab.backup_brain('g0');lab.call('board','brain_open',request_id=str(uuid.uuid4()))
        note=Path(lab.config['vault'])/'politica-remoto.md'
        note.write_text('---\nsource: politica-remoto\nversion: 2\nvalid_at: 2026-02-01T00:00:00Z\ndomain: publico\n---\nA empresa ACME adota a Política Remoto versão 2. A Política Remoto versão 2 autoriza os funcionários da ACME a trabalhar remotamente três dias por semana.',encoding='utf-8')
        draft=lab.call('owner','editorial',command={'action':'submit','path':note.name})
        lab.call('board','editorial',command={'action':'review','id':draft['id'],'raw_sha':draft['raw_sha']})
        lab.publish(draft['id'],crash=True)
        count=signed_request(lab.authority_client,action='proof')['budgets']['model']['reserved']
        assert lab.call('owner','status',job=first['id'])['result']==original
        lab.publish(draft['id'])
        assert signed_request(lab.authority_client,action='proof')['budgets']['model']['reserved']==count
        lab.mark('stage_before_canonical_commit_crash_resumes_without_model_reingestion')
        lab.call('board','revoke',principal='owner',source='aquisicao')
        denied(lambda:lab.call('owner','status',job=first['id']),403)
        latest=lab.backup_brain('g1')
        with pytest.raises(ValueError,match='stale'):lab.restore_brain(old)
        corrupt=lab.state/'corrupt-bundle';shutil.copytree(latest,corrupt)
        (corrupt/'knowledge.dump').write_bytes(b'not an authenticated dump')
        manifest=json.loads((corrupt/'manifest.json').read_text(encoding='utf-8'));manifest['files']['knowledge.dump']=hashlib.sha256((corrupt/'knowledge.dump').read_bytes()).hexdigest()
        (corrupt/'manifest.json').write_text(dump(manifest),encoding='utf-8')
        with pytest.raises(ValueError,match='tampered'):lab.restore_brain(corrupt)
        lab.mark('signed_bundle_witness_refuses_stale_and_modified_dumps_before_live_changes')
        lab.stop_native()
        lab.brain_key=secrets.token_hex(32);lab.embedding_key=secrets.token_hex(32);lab.config['editorialKey']=secrets.token_hex(32)
        lab.restore_brain(latest)
        assert lab.call('board','brain_status')['frozen']
        denied(lambda:lab.new_signed(['policy_lookup'],execute=False,maxUnits=1),503)
        lab.call('board','brain_open',request_id=str(uuid.uuid4()))
        denied(lambda:lab.call('owner','status',job=first['id']),403)
        assert lab.call('board','status',job=first['id'])['result']==original
        current=lab.new_signed(['policy_lookup'],execute=False,maxUnits=1);assert lab.run_worker(current['id'])['completed']
        response=lab.call('owner','status',job=current['id'])['result']['evidence'][0]['snapshot']
        assert response['version']==2
        assert 'três' in response['semantic']['answer'].lower() or '3' in response['semantic']['answer']
        lab.mark('cold_joint_restore_vectors_graph_canonical_checkpoints_keys_and_revocation')
        lab.evidence['responses']={'original':original,'current':response}
        lab.evidence['result']='PASS_BOUNDED_NATIVE_BRAIN_RECOVERY'
    except BaseException as error:
        lab.evidence['result']='FAIL';lab.evidence['error']=lab.redact(repr(error));raise
    finally:
        lab.evidence['seconds']=time.perf_counter()-started
        try:lab.stop_native()
        except Exception:pass
        try:lab.cleanup();lab.evidence['disposable_resources_removed']=True
        finally:lab.save()
