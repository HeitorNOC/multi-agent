"""Larger fictional domain on the existing engines; no claim of enterprise load."""
import hashlib,hmac,json,os,pathlib,secrets,sqlite3,subprocess,sys,threading,time,uuid
from http.server import BaseHTTPRequestHandler,ThreadingHTTPServer
from urllib.request import Request,urlopen
ROOT=pathlib.Path(__file__).resolve().parents[1];HERE=ROOT/'demo-enterprise'
sys.path.insert(0,str(ROOT/'validation/brain-recovery'))
from test_brain import BrainLab
CORPUS=json.loads((HERE/'corpus.json').read_text(encoding='utf-8'));CATALOG=json.loads((HERE/'catalog.json').read_text(encoding='utf-8'));AGENTS={a['id']:a for a in CATALOG['agents']}
DOCS={d['source']:d for d in CORPUS['documents'] if d['current']}
prior=json.loads((HERE/'.state/prior-attempt.json').read_text()) if (HERE/'.state/prior-attempt.json').exists() else {'reserved_calls':0}
CAP=64-prior['reserved_calls']
state=HERE/'.state'/('session-'+uuid.uuid4().hex[:10]);state.mkdir(parents=True)
token=secrets.token_hex(32);stop=threading.Event();lock=threading.Lock();retrieval_lock=threading.Lock();cache={};lab=None;node=None;api=''
progress={'phase':'starting','message':'Preparando o cérebro do Grupo Aurora.','sources':[]}
with sqlite3.connect(state/'model-slots.sqlite') as db:db.execute('CREATE TABLE slots(job TEXT,slot TEXT,prompt_sha TEXT,status TEXT,result TEXT,PRIMARY KEY(job,slot))')
class EnterpriseLab(BrainLab):
    def __init__(self):
        super().__init__();self.state=state/'engines';self.state.mkdir();self.evidence_dir=state/'evidence';self.evidence_dir.mkdir();self.projections={}
        self.native_options={'profile':'enterprise-demo','synthetic_corpus_sha':hashlib.sha256((HERE/'corpus.json').read_bytes()).hexdigest()}
        self.embedding_options={'pool_long_inputs':True}
    def authority(self):
        self.authority_config['caps']['model']=CAP;super().authority()
    def stage(self,d):
        payload={'installation':self.id,'source':d['source'],'version':d['version'],'content_sha':hashlib.sha256(d['content'].encode()).hexdigest(),'raw_sha':hashlib.sha256(('fictional-original:'+d['content']).encode()).hexdigest(),'domain':d['area'],'draft':uuid.uuid4().hex,'reviewer':'aurora-fixture-reviewer','valid_at':'2026-11-01T00:00:00Z','known_at':'2026-11-05T19:45:00Z'}
        raw=json.dumps(payload,separators=(',',':'),ensure_ascii=False)
        result=self.native('stage',release={'payload':payload,'payload_json':raw,'signature':hmac.new(bytes.fromhex(self.config['editorialKey']),raw.encode(),hashlib.sha256).hexdigest(),'content':d['content']})
        self.projections[d['source']]=result['id'];return {**d,'sha256':payload['content_sha'],'projection':result['id']}
def request(url,data):
    with urlopen(Request(url,json.dumps(data).encode(),{'content-type':'application/json','x-demo-token':token}),timeout=30) as res:return json.load(res)
def usage():
    path=state/'engines/model/model-calls.jsonl';rows=[json.loads(x) for x in path.read_text(encoding='utf-8').splitlines() if x.strip()] if path.exists() else []
    return {'calls':len(rows),'max_calls':CAP,'input_tokens':sum(u.get('input_tokens',0) for r in rows for u in r['usage']),'cached_input_tokens':sum(u.get('cached_input_tokens',0) for r in rows for u in r['usage']),'output_tokens':sum(u.get('output_tokens',0) for r in rows for u in r['usage']),'money':'Uso Codex de bancada; valor monetário não medido.'}
def current_job(id):return request(api+'/internal/snapshot',{'job':id})
def require_selected(job,agent):
    if agent not in AGENTS or not job['plan'] or agent not in job['plan']['capabilities']:raise ValueError('Agente não selecionado pelo Chief of Staff')
def model(p):
    job=current_job(p['job']);slot=p['slot']
    if slot=='plan':pass
    elif slot=='synthesis':
        if not job['plan']:raise ValueError('Plano ausente')
    elif slot.startswith('agent:'):require_selected(job,slot[6:])
    else:raise ValueError('Slot fora do catálogo')
    sha=hashlib.sha256(p['prompt'].encode()).hexdigest()
    with lock,sqlite3.connect(state/'model-slots.sqlite') as db:
        row=db.execute('SELECT prompt_sha,status,result FROM slots WHERE job=? AND slot=?',(p['job'],slot)).fetchone()
        if row:
            if row[0]!=sha:raise ValueError('Prompt divergiu do original')
            if row[1]!='completed':raise ValueError('Inferência com resultado desconhecido; sem reexecução automática')
            return json.loads(row[2])
        limit=job['plan']['max_model_calls'] if job['plan'] else 1
        if db.execute('SELECT count(*) FROM slots WHERE job=?',(p['job'],)).fetchone()[0]>=limit:raise ValueError('Orçamento de slots excedido')
        db.execute('INSERT INTO slots VALUES(?,?,?,?,?)',(p['job'],slot,sha,'unknown',None));db.commit()
    value=lab.native('evaluation',prompt=p['prompt'])
    with sqlite3.connect(state/'model-slots.sqlite') as db:db.execute("UPDATE slots SET status='completed',result=? WHERE job=? AND slot=?",(json.dumps(value,ensure_ascii=False),p['job'],slot))
    return value
def retrieve(p):
    job=current_job(p['job']);agent=p['agent'];require_selected(job,agent);rows=[]
    for source in AGENTS[agent]['sources']:
        with retrieval_lock:
            if source not in cache:
                d=DOCS[source]
                query='Grupo Aurora '+d['title']+'. Recupere os fatos, números, condições, prazos e referências deste documento vigente.'
                result=lab.native('query',id=lab.projections[source],query=query,mode='mix',only_need_context=True,hl_keywords=[d['area'],'Grupo Aurora'],ll_keywords=[source,'SKU-AURA' if d['area'] not in ['technology','people'] and source!='aurora-response' else 'INC-47'])
                context=result['answer']
                if not isinstance(context,str) or '[no-context]' in context:raise ValueError('Contexto obrigatório não recuperado: '+source)
                cache[source]={'source':source,'title':d['title'],'version':d['version'],'sha256':hashlib.sha256(d['content'].encode()).hexdigest(),'context':context,'retrieval_mode':'LightRAG mix; graph + vectors'}
            rows.append(cache[source])
    return rows
class Handler(BaseHTTPRequestHandler):
    def log_message(self,*args):pass
    def do_POST(self):
        def send(value,status=200):self.send_response(status);self.send_header('Content-Type','application/json');self.end_headers();self.wfile.write(json.dumps(value,ensure_ascii=False).encode())
        if not hmac.compare_digest(self.headers.get('x-demo-token',''),token):return send({'error':'forbidden'},403)
        try:
            length=int(self.headers.get('content-length',0))
            if length>65536:raise ValueError('Payload excedido')
            p=json.loads(self.rfile.read(length));action=p['action']
            if action=='status':return send({**progress,'usage':usage(),'company':CORPUS['company'],'catalog':CATALOG['agents'],'scenarios':CATALOG['scenarios'],'history':[d for d in CORPUS['documents'] if not d['current']],'scope':'Simulação de domínio empresarial; não é ensaio de carga de empresa grande.'})
            if action=='stop':stop.set();return send({'stopping':True})
            if progress['phase']!='ready':raise ValueError('Cérebro ainda em preparação')
            if action=='worker_config':return send({'dsn':lab.dsn,'backend':backend})
            if action=='retrieve':return send(retrieve(p))
            if action=='llm':return send(model(p))
            raise ValueError('Operação desconhecida')
        except Exception as error:
            with (state/'backend-errors.log').open('a',encoding='utf-8') as f:f.write(lab.redact(repr(error))+'\n' if lab else repr(error)+'\n')
            send({'error':'Operação recusada ou incompleta; consulte o log local da simulação.'},409)
server=ThreadingHTTPServer(('127.0.0.1',0),Handler);backend='http://127.0.0.1:'+str(server.server_port);threading.Thread(target=server.serve_forever,daemon=True).start()
try:
    subprocess.run(['node',str(HERE/'build.cjs')],cwd=ROOT,check=True,capture_output=True)
    node_log=(state/'node.log').open('w',encoding='utf-8')
    node=subprocess.Popen(['node',str(ROOT/'demo/server.ts')],stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=node_log,text=True,encoding='utf-8',cwd=ROOT)
    node.stdin.write(json.dumps({'state':str(state),'root':str(ROOT),'backend':backend,'token':token,'python':str(ROOT/'validation/integrated-pilot/.venv/Scripts/python.exe'),'policyModule':(HERE/'policy.ts').as_uri(),'worker':str(HERE/'worker.py'),'uiDir':str(HERE)}));node.stdin.close()
    ready=json.loads(node.stdout.readline());api=ready['url']
    (HERE/'.state/active.json').write_text(json.dumps({'url':api,'backend':backend,'token':token,'state':str(state),'launcher_pid':os.getpid()},indent=2),encoding='utf-8')
    print(json.dumps({'url':api,'state':str(state)}),flush=True)
    lab=EnterpriseLab();progress.update(message='Iniciando bancos, embeddings e LightRAG.');lab.start()
    for i,d in enumerate(DOCS.values()):
        if stop.is_set():break
        progress.update(phase='indexing',message=f'Indexando documento vigente {i+1}/{len(DOCS)}: '+d['title']);progress['sources'].append(lab.stage(d))
    if stop.is_set():raise InterruptedError('Preparação interrompida pelo operador')
    progress.update(phase='ready',message='Cérebro pronto. Escolha um cenário para o Chief compor a equipe.')
    (state/'environment.json').write_text(json.dumps({'installation':lab.id,'versions':lab.evidence['versions'],'langgraph_sha':lab.evidence['source_sha'],'sources':progress['sources'],'catalog':CATALOG,'global_model_cap':CAP,'production_approved':False},ensure_ascii=False,indent=2),encoding='utf-8')
    while not stop.wait(1):
        if node.poll() is not None:break
except Exception as error:
    progress.update(phase='failed',message='Falha na preparação; logs locais preservados.')
    (state/'startup-error.log').write_text(lab.redact(repr(error)) if lab else repr(error),encoding='utf-8');print(json.dumps({'failed':True,'type':type(error).__name__}),flush=True)
    while node and node.poll() is None and not stop.wait(1):pass
finally:
    if node and node.poll() is None:node.terminate();node.wait(timeout=10)
    if lab:lab.cleanup()
    server.shutdown();server.server_close()
