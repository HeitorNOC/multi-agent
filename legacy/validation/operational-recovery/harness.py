"""Own disposable installation. Secrets remain in memory and private .state only."""
import hashlib,json,os,queue,secrets,shutil,socket,subprocess,sys,threading,time,uuid
from pathlib import Path
from urllib.request import Request,urlopen
from urllib.parse import urlencode
from urllib.error import HTTPError,URLError
from protocol import request

HERE=Path(__file__).resolve().parent;ROOT=HERE.parents[1]
PY=ROOT/'validation/integrated-pilot/.venv/Scripts/python.exe'
PG='pgvector/pgvector@sha256:c0cd736fe8b8b5d408db56b780570bac404fe518e66e39de624aa46f9aabc60a'
NEO='neo4j@sha256:fe8607113c4177fbd2466bf2c30f1ebab5b9530594e86487c58c98e113145192'
KC='quay.io/keycloak/keycloak@sha256:de6ed510b59cfcd25f129ba4118696fa10d4165eee921a8d846178b6d35d30f7'


def free_port():
    with socket.socket() as s:s.bind(('127.0.0.1',0));return s.getsockname()[1]


def http(url,data=None,token=None,form=False,method=None):
    raw=urlencode(data).encode() if form else json.dumps(data).encode() if data is not None else None
    headers={'content-type':'application/x-www-form-urlencoded' if form else 'application/json'}
    if token:headers['authorization']='Bearer '+token
    try:
        with urlopen(Request(url,raw,headers,method=method),timeout=15) as res:
            body=res.read();return json.loads(body) if body else None
    except HTTPError as e:raise RuntimeError(str(e.code)+' '+e.read().decode()) from e


class Installation:
    def __init__(self):
        self.id=uuid.uuid4().hex[:10];self.prefix='recovery-audit-'+self.id
        self.state=HERE/'.state'/self.id;self.state.mkdir(parents=True)
        self.volumes=[];self.containers=[];self.logs=[];self.children=[];self.app=None;self.provider=None
        self.pg_name=self.prefix+'-pg';self.neo_name=self.prefix+'-neo';self.kc_name=self.prefix+'-idp'
        self.network=self.prefix+'-net';self.secret=secrets.token_hex(24);self.admin=secrets.token_hex(20)
        self.pg_port=free_port();self.neo_port=free_port();self.kc_port=free_port()
        self.issuer=f'http://127.0.0.1:{self.kc_port}/realms/piloto'
        self.clients={name:secrets.token_hex(24) for name in ['analista','financeiro','aprovador','auditor','executor']}
        self.role={'analista':'analyst','financeiro':'finance','aprovador':'board','auditor':'board','executor':'worker'}
        self.evidence={'installation':self.id,'images':{'postgres':PG,'neo4j':NEO,'keycloak':KC},'scenarios':[],'worker_calls':[]}
        self.authority_key=secrets.token_hex(32)
        self.authority_state=self.state/'authority.json'
        self.authority_state.write_text(json.dumps({'documents':[],'sequence':0,'mode':'normal','security_head':''}))
        self.embedding_key=secrets.token_hex(32)
        self.editorial_key=secrets.token_hex(32)
    def d(self,*args,input=None,check=True,timeout=60):
        proc=subprocess.run(['docker',*args],input=input,capture_output=True,timeout=timeout)
        if check and proc.returncode:
            error=proc.stderr.decode(errors='replace')+proc.stdout.decode(errors='replace')
            for value in [self.secret,self.admin,*self.clients.values()]:error=error.replace(value,'[redacted]')
            raise RuntimeError(error[-6000:])
        return proc
    def volume(self,suffix):
        name=self.prefix+'-'+suffix;self.d('volume','create','--label','pilot.owner='+self.prefix,name);self.volumes.append(name);return name
    def pg(self,volume):
        self.pg_volume=volume
        self.d('run','-d','--name',self.pg_name,'--label','pilot.owner='+self.prefix,'--network',self.network,'--network-alias','pg',
               '--user','postgres','--cap-drop','ALL','--security-opt','no-new-privileges=true','--memory','768m','--cpus','1','--pids-limit','128',
               '--mount',f'type=volume,src={volume},dst=/var/lib/postgresql/data','-p',f'127.0.0.1:{self.pg_port}:5432','-e','POSTGRES_PASSWORD='+self.secret,PG)
        if self.pg_name not in self.containers:self.containers.append(self.pg_name)
        for _ in range(100):
            if self.d('exec',self.pg_name,'pg_isready','-h','127.0.0.1','-U','postgres',check=False).returncode==0:return
            time.sleep(.2)
        raise RuntimeError('PostgreSQL startup deadline')
    def sql(self,q,database='postgres'):
        return self.d('exec','-i',self.pg_name,'psql','-XqAt','-v','ON_ERROR_STOP=1','-U','postgres','-d',database,input=q.encode()).stdout.decode().strip()
    def neo(self,volume):
        self.neo_volume=volume
        self.d('run','-d','--name',self.neo_name,'--label','pilot.owner='+self.prefix,'--network',self.network,
               '--user','neo4j','--cap-drop','ALL','--security-opt','no-new-privileges=true','--memory','1g','--cpus','1','--pids-limit','128',
               '--mount',f'type=volume,src={volume},dst=/data','-p',f'127.0.0.1:{self.neo_port}:7687','-e','NEO4J_AUTH=neo4j/'+self.secret,
               '-e','NEO4J_dbms_usage__report_enabled=false',
               '-e','NEO4J_server_memory_heap_initial__size=256m','-e','NEO4J_server_memory_heap_max__size=256m','-e','NEO4J_server_memory_pagecache_size=128m',NEO)
        if self.neo_name not in self.containers:self.containers.append(self.neo_name)
        self.wait_neo()
    def wait_neo(self):
        for _ in range(80):
            if self.d('exec',self.neo_name,'cypher-shell','-u','neo4j','-p',self.secret,'--format','plain','RETURN 1 AS ready',check=False).returncode==0:return
            time.sleep(.5)
        raise RuntimeError('Neo4j startup deadline')
    def idp(self):
        self.d('run','-d','--name',self.kc_name,'--label','pilot.owner='+self.prefix,'--network',self.network,
               '--cap-drop','ALL','--security-opt','no-new-privileges=true','--memory','1g','--cpus','1','--pids-limit','256',
               '-p',f'127.0.0.1:{self.kc_port}:8080','-e','KC_DB=postgres','-e','KC_DB_URL=jdbc:postgresql://pg:5432/identity',
               '-e','KC_DB_USERNAME=identity_owner','-e','KC_DB_PASSWORD='+self.secret,'-e','KC_DB_POOL_MIN_SIZE=1','-e','KC_DB_POOL_MAX_SIZE=5',
               '-e','KC_BOOTSTRAP_ADMIN_USERNAME=pilot-admin','-e','KC_BOOTSTRAP_ADMIN_PASSWORD='+self.admin,
               KC,'start','--http-enabled=true','--hostname='+f'http://127.0.0.1:{self.kc_port}')
        if self.kc_name not in self.containers:self.containers.append(self.kc_name)
        self.wait_idp()
    def wait_idp(self):
        deadline=time.monotonic()+150
        while time.monotonic()<deadline:
            try:http(f'http://127.0.0.1:{self.kc_port}/realms/master/.well-known/openid-configuration');return
            except (RuntimeError,URLError,ConnectionError):time.sleep(1)
        raise RuntimeError('Keycloak startup deadline')
    def enroll(self):
        base=f'http://127.0.0.1:{self.kc_port}'
        admin=http(base+'/realms/master/protocol/openid-connect/token',{'grant_type':'password','client_id':'admin-cli','username':'pilot-admin','password':self.admin},form=True)['access_token']
        http(base+'/admin/realms',{'realm':'piloto','enabled':True,'sslRequired':'none','accessTokenLifespan':120},admin)
        principals=[]
        for name,secret in self.clients.items():
            client={'clientId':name,'enabled':True,'secret':secret,'serviceAccountsEnabled':True,'standardFlowEnabled':False,'directAccessGrantsEnabled':False,'publicClient':False,
                    'protocolMappers':[{'name':'brain-audience','protocol':'openid-connect','protocolMapper':'oidc-audience-mapper','config':{'included.custom.audience':'brain-api','access.token.claim':'true','id.token.claim':'false'}}]}
            http(base+'/admin/realms/piloto/clients',client,admin)
            clients=http(base+'/admin/realms/piloto/clients?clientId='+name,token=admin)
            account=http(base+'/admin/realms/piloto/clients/'+clients[0]['id']+'/service-account-user',token=admin)
            principals.append({'id':account['id'],'name':name,'role':self.role[name]})
        self.principals=principals
    def token(self,name):
        return http(self.issuer+'/protocol/openid-connect/token',{'grant_type':'client_credentials','client_id':name,'client_secret':self.clients[name]},form=True)['access_token']
    def process(self,script,config,env=None):
        log=open(self.state/(script+'-'+str(len(self.logs))+'.log'),'w',encoding='utf-8');self.logs.append(log)
        executable=ROOT/'validation/decision-qualification/.embedding-venv/Scripts/python.exe' if script=='embedding_server' else PY
        proc=subprocess.Popen([str(executable),'-X','utf8',str(HERE/(script+'.py'))],cwd=ROOT,stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=log,text=True,encoding='utf-8',env={**os.environ,'PYTHONIOENCODING':'utf-8','LANGSMITH_TRACING':'false','LANGCHAIN_TRACING_V2':'false',**(env or {})})
        self.children.append(proc);proc.stdin.write(json.dumps(config)+'\n');proc.stdin.flush();proc.stdin.close()
        messages=queue.Queue()
        def reader():
            for line in proc.stdout:
                try:
                    value=json.loads(line)
                    if value.get('ready'):messages.put(value);return
                except ValueError:pass
        threading.Thread(target=reader,daemon=True).start()
        try:ready=messages.get(timeout=80)
        except queue.Empty:raise RuntimeError(script+' startup deadline; see private sanitized logs')
        return proc,'http://127.0.0.1:'+str(ready['port'])
    def start_app(self,restoring=False):
        self.app_config={'installation':self.id,'state':str(self.app_state),'dsn':self.app_dsn,'issuer':self.issuer,'principals':self.principals,
                         'provider_url':self.provider_url,'provider_key':self.provider_key,'security_journal':str(self.state/'security-journal.jsonl'),
                         'journal_key':self.journal_key,'restoring':restoring,'restore_generation':'g1',
                         'authority_url':self.authority_url,'authority_key':self.authority_key}
        self.app_config.update(embedding_url=self.embedding_url,embedding_key=self.embedding_key,
                               model_budget=str(self.state/'model-budget.json'),evidence=str(HERE/'evidence'),
                               model_cwd=str(HERE/'model-io'))
        self.app_config.update(editorial_key=self.editorial_key,editorial_db=str(self.state/'editorial.sqlite'),
            vault=str(self.state/'vault'),decision_dsn=f'postgresql://decision_writer:{self.secret}@127.0.0.1:{self.pg_port}/pilot',
            model_name=os.environ.get('AUDIT_MODEL','gpt-6.1-terra'),retrieval_mode=os.environ.get('AUDIT_RETRIEVAL','mix'))
        self.app_config.update(getattr(self,'recovered_paths',{}))
        self.app_config['journal_anchor']=str(self.state/'security-head.json')
        self.app_config['recovery_permit']=getattr(self,'recovery_permit',None)
        Path(self.app_config['vault']).mkdir(exist_ok=True)
        env={'POSTGRES_HOST':'127.0.0.1','POSTGRES_PORT':str(self.pg_port),'POSTGRES_USER':'knowledge_owner','POSTGRES_PASSWORD':self.secret,'POSTGRES_DATABASE':'knowledge',
             'POSTGRES_MAX_CONNECTIONS':'5','POSTGRES_WORKSPACE':'','NEO4J_WORKSPACE':'','NEO4J_URI':f'bolt://127.0.0.1:{self.neo_port}',
             'NEO4J_USERNAME':'neo4j','NEO4J_PASSWORD':self.secret,'NEO4J_DATABASE':'neo4j','NEO4J_MAX_CONNECTION_POOL_SIZE':'5'}
        self.app,self.api=self.process('application',self.app_config,env)
    def stop_app(self):
        if self.app and self.app.poll() is None:self.app.terminate();self.app.wait(timeout=10)
    def start(self):
        self.d('network','create','--label','pilot.owner='+self.prefix,self.network)
        self.pg(self.volume('pg-data'))
        self.sql("CREATE ROLE app_owner LOGIN NOSUPERUSER NOBYPASSRLS PASSWORD '"+self.secret+"';CREATE ROLE knowledge_owner LOGIN NOSUPERUSER NOBYPASSRLS PASSWORD '"+self.secret+"';CREATE ROLE identity_owner LOGIN NOSUPERUSER NOBYPASSRLS PASSWORD '"+self.secret+"';CREATE ROLE workflow_runtime LOGIN NOSUPERUSER NOBYPASSRLS PASSWORD '"+self.secret+"';CREATE DATABASE pilot OWNER app_owner;CREATE DATABASE knowledge OWNER knowledge_owner;CREATE DATABASE identity OWNER identity_owner;")
        self.sql('CREATE EXTENSION pgcrypto;CREATE SCHEMA runtime AUTHORIZATION workflow_runtime;','pilot');self.sql('CREATE EXTENSION vector;','knowledge')
        self.sql("CREATE ROLE decision_writer LOGIN NOSUPERUSER NOBYPASSRLS PASSWORD '"+self.secret+"';")
        self.neo(self.volume('neo-data'));self.idp();self.enroll()
        self.provider_key=secrets.token_hex(32);self.journal_key=secrets.token_hex(32)
        self.provider,self.provider_url=self.process('provider',{'path':str(self.state/'external-provider.sqlite'),'secret':self.provider_key})
        self.app_state=self.state/'application-state';self.app_dsn=f'postgresql://app_owner:{self.secret}@127.0.0.1:{self.pg_port}/pilot'
        self.runtime_dsn=f'postgresql://workflow_runtime:{self.secret}@127.0.0.1:{self.pg_port}/pilot?options=-csearch_path%3Druntime&connect_timeout=5'
        self.authority,self.authority_url=self.process('authority',{'path':str(self.authority_state),'secret':self.authority_key,'installation':self.id})
        self.embedding,self.embedding_url=self.process('embedding_server',{'secret':self.embedding_key,
            'weights':str(ROOT/'validation/decision-qualification/.models/faf4aa4225822f3bc6376869cb1164e8e3feedd0'),
            'evidence':str(HERE/'evidence/embedding-calls.jsonl')})
        self.start_app()
        self.evidence['versions']={'postgres':self.sql('SELECT version();'),'pgvector':self.sql("SELECT extversion FROM pg_extension WHERE extname='vector';",'knowledge'),
                                   'neo4j':self.d('exec',self.neo_name,'cypher-shell','-u','neo4j','-p',self.secret,'--format','plain','CALL dbms.components() YIELD versions RETURN versions').stdout.decode().strip(),
                                   'keycloak':'26.8.1'}
    def call(self,actor,path,data=None,method=None):return request(self.api,path,self.token(actor),data,method)
    def engine(self,id,resume=False,expected=0):
        config={'api':self.api,'token':self.token('executor'),'run':id,'installation':self.id,'dsn':self.runtime_dsn,'resume':resume}
        proc=subprocess.run([str(PY),'-X','utf8',str(HERE/'engine.py')],input=json.dumps(config),capture_output=True,text=True,encoding='utf-8',cwd=ROOT,timeout=90,env={**os.environ,'LANGSMITH_TRACING':'false','LANGCHAIN_TRACING_V2':'false'})
        stderr=proc.stderr
        for secret in [self.secret,self.provider_key,self.journal_key,*self.clients.values(),config['token']]:stderr=stderr.replace(secret,'[redacted]')
        self.evidence['worker_calls'].append({'resume':resume,'exit_code':proc.returncode,'stdout':proc.stdout,'stderr':stderr[-5000:]})
        if expected==0 and proc.returncode:raise AssertionError(stderr[-5000:])
        if expected!=0 and proc.returncode==0:raise AssertionError('expected uncertain external delivery to fail')
        return json.loads(proc.stdout) if proc.returncode==0 else None
    def neo_backup(self,path,operation,volume):
        helper=self.prefix+'-'+operation;self.containers.append(helper)
        args=['run','--name',helper,'--label','pilot.owner='+self.prefix,'--network','none','--user','neo4j','--memory','768m',
              '--mount',f'type=volume,src={volume},dst=/data','--mount',f'type=bind,src={path.resolve()},dst=/backups',
              '--entrypoint','neo4j-admin',NEO,'database',operation,'neo4j']
        args+=['--to-path=/backups','--overwrite-destination=true'] if operation=='dump' else ['--from-path=/backups','--overwrite-destination=true']
        self.d(*args,timeout=90)
        self.d('rm',helper);self.containers.remove(helper)
    def backup(self):
        self.stop_app();self.d('stop',self.kc_name);self.d('stop',self.neo_name)
        path=self.state/'backup-g1';path.mkdir()
        try:
            for db in ['pilot','knowledge','identity']:(path/(db+'.dump')).write_bytes(self.d('exec',self.pg_name,'pg_dump','-U','postgres','-Fc',db).stdout)
            (path/'roles.sql').write_bytes(self.d('exec',self.pg_name,'pg_dumpall','-U','postgres','--globals-only').stdout)
            shutil.copytree(self.app_state,path/'application-state')
            self.neo_backup(path,'dump',self.neo_volume)
            files={p.relative_to(path).as_posix():{'bytes':p.stat().st_size,'sha256':hashlib.sha256(p.read_bytes()).hexdigest()} for p in path.rglob('*') if p.is_file()}
            (path/'manifest.json').write_text(json.dumps({'generation':'g1','files':files},indent=2))
            self.backup_path=path;self.evidence['backup_manifest']={'generation':'g1','files':files}
            return path
        finally:
            self.d('start',self.neo_name);self.wait_neo();self.d('start',self.kc_name);self.wait_idp();self.start_app()
    def verify_backup(self):
        path=self.backup_path;manifest=json.loads((path/'manifest.json').read_text())
        for name,meta in manifest['files'].items():
            if hashlib.sha256((path/name).read_bytes()).hexdigest()!=meta['sha256']:raise ValueError('backup hash mismatch: '+name)
    def restore(self):
        self.verify_backup();self.stop_app();self.d('stop',self.kc_name);self.d('rm',self.kc_name)
        self.d('stop',self.neo_name);self.d('rm',self.neo_name)
        self.d('stop',self.pg_name);self.d('rm',self.pg_name)
        self.pg(self.volume('restored-pg'))
        roles=(self.backup_path/'roles.sql').read_text();roles='\n'.join(line for line in roles.splitlines() if line.strip()!='CREATE ROLE postgres;')
        self.sql(roles)
        for db,owner in [('pilot','app_owner'),('knowledge','knowledge_owner'),('identity','identity_owner')]:
            self.sql(f'CREATE DATABASE {db} OWNER {owner};')
            self.d('exec','-i',self.pg_name,'pg_restore','--exit-on-error','-U','postgres','-d',db,input=(self.backup_path/(db+'.dump')).read_bytes())
        neo_volume=self.volume('restored-neo');self.neo_backup(self.backup_path,'load',neo_volume);self.neo(neo_volume)
        self.idp()
        self.app_state=self.state/'restored-application';shutil.copytree(self.backup_path/'application-state',self.app_state)
        self.start_app(restoring=True)
    def provider_rpc(self,p):
        import hmac
        p={**p,'issued':time.time()};raw=json.dumps(p).encode();sig=hmac.new(bytes.fromhex(self.provider_key),raw,hashlib.sha256).hexdigest()
        with urlopen(Request(self.provider_url+'/rpc',raw,{'content-type':'application/json','x-signature':sig}),timeout=10) as r:return json.load(r)
    def close(self):
        for proc in self.children:
            if proc.poll() is None:proc.terminate();proc.wait(timeout=10)
        for log in self.logs:log.close()
        for name in list(dict.fromkeys(self.containers)):
            assert name.startswith(self.prefix+'-')
            data=self.d('logs',name,check=False)
            raw=(data.stdout+data.stderr).decode(errors='replace')
            for secret in [self.secret,self.admin,*self.clients.values()]:raw=raw.replace(secret,'[redacted]')
            (HERE/'evidence'/(name.rsplit('-',1)[-1]+'-server.log')).write_text(raw,encoding='utf-8')
            self.d('rm','-f',name,check=False)
        removed=[]
        for volume in self.volumes:
            assert volume.startswith(self.prefix+'-');removed.append(self.d('volume','rm',volume,check=False).returncode==0)
        self.evidence['cleanup']={'volumes_removed':removed,'network_removed':self.d('network','rm',self.network,check=False).returncode==0}
        # Private logs may contain synthetic document text; redact all transient credentials.
        for path in self.state.glob('*.log'):
            raw=path.read_text(encoding='utf-8',errors='replace')
            for secret in [self.secret,self.admin,self.authority_key,self.embedding_key,self.editorial_key,getattr(self,'provider_key',''),getattr(self,'journal_key',''),*self.clients.values()]:
                if secret:raw=raw.replace(secret,'[redacted]')
            (HERE/'evidence'/path.name).write_text(raw,encoding='utf-8')
        (HERE/'evidence/integration.json').write_text(json.dumps(self.evidence,ensure_ascii=False,indent=2),encoding='utf-8')
