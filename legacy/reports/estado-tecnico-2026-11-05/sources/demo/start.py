"""Local development launcher reusing audited fixture infrastructure and native engines."""
import hashlib,hmac,json,os,pathlib,secrets,socket,sqlite3,subprocess,sys,threading,time,uuid
from http.server import BaseHTTPRequestHandler,ThreadingHTTPServer
ROOT=pathlib.Path(__file__).resolve().parents[1];HERE=ROOT/'demo'
sys.path.insert(0,str(ROOT/'validation/brain-recovery'))
from test_brain import BrainLab
from authority_client import request as authority_request

DOCS=json.loads((ROOT/'validation/investment-gate/corpus.json').read_text(encoding='utf-8'))['documents']
SOURCES=['sales-january','sales-february','inventory']
QUESTIONS={'sales-january':'What are ACME January orders, average price and revenue?', 'sales-february':'What are ACME February orders, average price and revenue?','inventory':'What are ACME January and February stockout counts and is a cause for revenue decline proven?'}
state=HERE/'.state'/('session-'+uuid.uuid4().hex[:10]);state.mkdir(parents=True)
token=secrets.token_hex(32);progress={'phase':'starting','message':'Inicializando os motores locais.','sources':[]};stop=threading.Event();lab=None;node=None
model_lock=threading.Lock()
with sqlite3.connect(state/'model-slots.sqlite') as slots:
    slots.execute('CREATE TABLE slots(job TEXT,slot TEXT,prompt_sha TEXT,status TEXT,result TEXT,PRIMARY KEY(job,slot))')
class DemoLab(BrainLab):
    def __init__(self):
        super().__init__();self.state=state/'engines';self.state.mkdir();self.evidence_dir=state/'evidence';self.evidence_dir.mkdir()
        self.native_options={'profile':'investment','synthetic_corpus_sha':hashlib.sha256((ROOT/'validation/investment-gate/corpus.json').read_bytes()).hexdigest()}
        self.projections={}
    def stage(self,doc):
        content=doc['content'];payload={'installation':self.id,'source':doc['source'],'version':doc['version'],'content_sha':hashlib.sha256(content.encode()).hexdigest(),'raw_sha':hashlib.sha256(('fixture:'+content).encode()).hexdigest(),'domain':'public','draft':uuid.uuid4().hex,'reviewer':'fixture-local','valid_at':'2026-01-01T00:00:00Z','known_at':'2026-11-05T00:00:00Z'}
        raw=json.dumps(payload,separators=(',',':'),ensure_ascii=False)
        result=self.native('stage',release={'payload':payload,'payload_json':raw,'signature':hmac.new(bytes.fromhex(self.config['editorialKey']),raw.encode(),hashlib.sha256).hexdigest(),'content':content})
        self.projections[doc['source']]=result['id']
        return {'source':doc['source'],'version':doc['version'],'content':content,'sha256':payload['content_sha'],'projection':result['id'],'mode':'publicação fictícia de demonstração'}
def usage():
    rows=[]
    path=state/'engines/model/model-calls.jsonl'
    if path.exists():
        for line in path.read_text(encoding='utf-8').splitlines():
            if line.strip():rows.append(json.loads(line))
    return {'calls':len(rows),'max_calls':16,'input_tokens':sum(u.get('input_tokens',0) for r in rows for u in r['usage']),'cached_input_tokens':sum(u.get('cached_input_tokens',0) for r in rows for u in r['usage']),'output_tokens':sum(u.get('output_tokens',0) for r in rows for u in r['usage']),'money':'Custo monetário não medido; chamadas Codex de bancada, sem fatura API atribuível.'}
class Handler(BaseHTTPRequestHandler):
    def log_message(self,*args):pass
    def do_POST(self):
        def send(value,status=200):
            self.send_response(status);self.send_header('Content-Type','application/json');self.end_headers();self.wfile.write(json.dumps(value,ensure_ascii=False).encode())
        if not hmac.compare_digest(self.headers.get('x-demo-token',''),token):return send({'error':'forbidden'},403)
        try:
            length=int(self.headers.get('content-length',0))
            if length>65536:raise ValueError('Payload excedido')
            p=json.loads(self.rfile.read(length));action=p['action']
            if action=='status':return send({**progress,'usage':usage(),'scope':'DEMO local · dados fictícios · ação simulada · sem login corporativo','installation':getattr(lab,'id',None)})
            if action=='stop':stop.set();return send({'stopping':True})
            if progress['phase']!='ready':raise ValueError('Motores ainda não prontos')
            if action=='worker_config':return send({'dsn':lab.dsn,'backend':backend})
            if action=='retrieve':
                source=p['source']
                if source not in SOURCES:raise ValueError('Fonte fora da demonstração')
                answer=lab.native('query',id=lab.projections[source],query=QUESTIONS[source],mode='naive',only_need_context=True)['answer']
                doc=next(d for d in progress['sources'] if d['source']==source)
                return send({'source':source,'version':doc['version'],'sha256':doc['sha256'],'context':answer})
            if action=='llm':
                if p['slot'] not in ['plan','sales_analysis','inventory_analysis','synthesis']:raise ValueError('Slot fora do orçamento do trabalho')
                uuid.UUID(p['job']);sha=hashlib.sha256(p['prompt'].encode()).hexdigest()
                # Reserve before calling the model. A missing result stays unknown;
                # restarting the worker does not silently spend again.
                with model_lock,sqlite3.connect(state/'model-slots.sqlite') as slots:
                    row=slots.execute('SELECT prompt_sha,status,result FROM slots WHERE job=? AND slot=?',(p['job'],p['slot'])).fetchone()
                    if row:
                        if row[0]!=sha:raise ValueError('Prompt divergiu do slot original')
                        if row[1]!='completed':raise ValueError('Inferência sem resultado conhecido; requer conciliação')
                        return send(json.loads(row[2]))
                    slots.execute('INSERT INTO slots VALUES(?,?,?,?,?)',(p['job'],p['slot'],sha,'unknown',None));slots.commit()
                result=lab.native('evaluation',prompt=p['prompt'])
                with sqlite3.connect(state/'model-slots.sqlite') as slots:slots.execute("UPDATE slots SET status='completed',result=? WHERE job=? AND slot=?",(json.dumps(result),p['job'],p['slot']))
                return send(result)
            raise ValueError('Operação desconhecida')
        except Exception as error:
            (state/'backend-errors.log').open('a',encoding='utf-8').write(type(error).__name__+': '+(lab.redact(str(error)) if lab else str(error))+'\n')
            send({'error':'Operação não concluída; veja os logs locais da demonstração.'},409)
server=ThreadingHTTPServer(('127.0.0.1',0),Handler);backend='http://127.0.0.1:'+str(server.server_port)
threading.Thread(target=server.serve_forever,daemon=True).start()
try:
    subprocess.run(['node',str(HERE/'build.cjs')],cwd=ROOT,check=True,capture_output=True)
    node_log=(state/'node.log').open('w',encoding='utf-8')
    node=subprocess.Popen(['node',str(HERE/'server.ts')],stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=node_log,text=True,encoding='utf-8',cwd=ROOT)
    node.stdin.write(json.dumps({'state':str(state),'root':str(ROOT),'backend':backend,'token':token,'python':str(ROOT/'validation/integrated-pilot/.venv/Scripts/python.exe')}));node.stdin.close()
    ready=json.loads(node.stdout.readline());active={'url':ready['url'],'backend':backend,'token':token,'state':str(state),'launcher_pid':os.getpid()}
    (HERE/'.state/active.json').write_text(json.dumps(active,indent=2),encoding='utf-8')
    print(json.dumps({'url':ready['url'],'state':str(state)}),flush=True)
    lab=DemoLab();progress.update(message='Iniciando PostgreSQL, Neo4j, embeddings e LightRAG.')
    lab.start()
    for doc in DOCS:
        if doc['source'] not in SOURCES:continue
        progress.update(phase='indexing',message='Publicando fonte fictícia: '+doc['source'])
        progress['sources'].append(lab.stage(doc))
    progress.update(phase='ready',message='Conhecimento pronto. Execute o pedido de análise.')
    (state/'environment.json').write_text(json.dumps({'installation':lab.id,'versions':lab.evidence['versions'],'langgraph_sha':lab.evidence['source_sha'],'ui':'React 19.2.8 / esbuild 0.28.2','sources':progress['sources'],'production_approved':False},indent=2),encoding='utf-8')
    while not stop.wait(1):
        if node.poll() is not None:break
except Exception as error:
    progress.update(phase='failed',message='Falha na inicialização; consulte os logs locais.')
    (state/'startup-error.log').write_text(lab.redact(repr(error)) if lab else repr(error),encoding='utf-8')
    print(json.dumps({'failed':True,'type':type(error).__name__}),flush=True)
    while node and node.poll() is None and not stop.wait(1):pass
finally:
    if node and node.poll() is None:node.terminate();node.wait(timeout=10)
    if lab:lab.cleanup()
    server.shutdown();server.server_close()
