"""Actual MVP API/UI connected to the existing signed protocol. Zero LLM."""
import http.cookiejar,json,pathlib,secrets,socket,sys,threading,urllib.request,urllib.error
from http.server import BaseHTTPRequestHandler,ThreadingHTTPServer
HERE=pathlib.Path(__file__).resolve().parent;ROOT=HERE.parents[1]
sys.path.insert(0,str(ROOT/'validation/observability-recovery'))
from test_recovery_contracts import Lab as ProtocolLab
sys.path.insert(0,str(ROOT/'demo'))
from recovery_bridge import RecoveryBridge,reviewers

class App:
    def __init__(self):
        self.lab=ProtocolLab();self.lab.state=HERE/'.state'/self.lab.id;self.lab.state.mkdir(parents=True)
        self.lab.evidence_dir=HERE/'evidence'/self.lab.id;self.lab.evidence_dir.mkdir(parents=True)
        self.key=secrets.token_hex(32);self.token=secrets.token_hex(32);self.drop_confirm_response=False;self.stop=threading.Event();self.confirm_calls=0
    def start(self):
        self.lab.start();self.bridge=RecoveryBridge(self.lab);owner=self
        class Handler(BaseHTTPRequestHandler):
            def log_message(self,*args):pass
            def send(self,result,status=200):
                raw=json.dumps(result).encode();self.send_response(status);self.send_header('content-type','application/json');self.end_headers()
                try:self.wfile.write(raw)
                except (BrokenPipeError,ConnectionResetError):pass
            def do_POST(self):
                if self.headers.get('x-demo-token')!=owner.token:return self.send({'error':'forbidden'},403)
                p=json.loads(self.rfile.read(int(self.headers['content-length'])))
                if p.get('action')=='stop':owner.stop.set();return self.send({'stopping':True})
                if p.get('action')=='status':return self.send({'phase':'ready','sources':[],'usage':{'calls':0,'max_calls':0},'scope':'recovery-only; controlled provider; zero LLM','installation':owner.lab.id})
                if p.get('action')!='recovery_bridge' or self.headers.get('x-recovery-bridge-token')!=owner.key:return self.send({'error':'forbidden'},403)
                if p['command']['action']=='recovery_confirm':owner.confirm_calls+=1
                result=owner.bridge.call(p)
                if owner.drop_confirm_response and p['command']['action']=='recovery_confirm' and result.get('ok'):
                    owner.drop_confirm_response=False;self.connection.shutdown(socket.SHUT_RDWR);self.connection.close();return
                return self.send(result)
        self.server=ThreadingHTTPServer(('127.0.0.1',0),Handler);self.backend='http://127.0.0.1:'+str(self.server.server_port)
        threading.Thread(target=self.server.serve_forever,daemon=True).start()
        state=self.lab.state/'console';state.mkdir()
        self.accounts=reviewers(state/'recovery-reviewers.json',self.lab.id)
        self.config={'state':str(state),'root':str(ROOT),'installation':self.lab.id,'backend':self.backend,'token':self.token,'recoveryBridgeKey':self.key,
                     'recoveryReviewers':self.accounts,'recoveryOnly':True,'uiDir':str(ROOT/'demo-enterprise'),'python':str(ROOT/'validation/integrated-pilot/.venv/Scripts/python.exe')}
        self.start_node()
    def start_node(self):
        self.node,self.url=self.lab.service(['node',str(ROOT/'demo/server.ts')],self.config)
    def restart_node(self):
        self.node.terminate();self.node.wait(timeout=8);self.start_node()
    def unknown_case(self):
        unknown,p,row=self.lab.admission();self.lab.control('crash_before_receipt',row['id'])
        try:self.lab.read(p)
        except Exception:pass
        assert self.lab.inference_process.wait(timeout=8)==80
        self.lab.stop_businesses();self.lab.inference_service();self.lab.start_business()
        return {'case_id':row['id'],'job':unknown['id'],'input_json':row['input_json']}
    def setup_cases(self):
        self.unknown=self.unknown_case()
        known,p,row=self.lab.admission();self.lab.control('inference_run',row['id'],input_json=row['input_json'])
        self.lab.call('board','retained_fault',target='read_commit',stage='after_business')
        try:self.lab.call('worker','read_commit',**p)
        except Exception:pass
        assert self.lab.business.wait(timeout=8)==82
        self.lab.stop_businesses();self.lab.start_business()
        self.known={'case_id':row['id'],'job':known['id'],'input_json':row['input_json']}
    def client(self,index=None):return Client(self,None if index is None else self.accounts[index]['credential'])
    def close(self):
        if hasattr(self,'server'):self.server.shutdown();self.server.server_close()
        self.lab.cleanup();self.lab.save()

class Client:
    def __init__(self,app,credential=None):
        self.app=app;self.opener=urllib.request.build_opener(urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))
        if credential:self.call('session',{'credential':credential})
    def call(self,path,body=None,headers=None):
        req=urllib.request.Request(self.app.url+'/api/recovery/'+path,None if body is None else json.dumps(body).encode(),{'content-type':'application/json',**(headers or {})})
        try:
            with self.opener.open(req,timeout=20) as res:return res.status,json.load(res)
        except urllib.error.HTTPError as error:return error.code,json.loads(error.read())
