"""Retained authority fixture. Independent process/store/key, not part of customer bundle."""
import hashlib,hmac,json,sqlite3,sys,threading,time
from http.server import BaseHTTPRequestHandler,ThreadingHTTPServer
from pathlib import Path
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey

def dump(v):return json.dumps(v,sort_keys=True,ensure_ascii=False,separators=(',',':'),default=str)
def sha(v):return hashlib.sha256(dump(v).encode()).hexdigest()

class Store:
    def __init__(self,path,installation,private):
        self.path=path;self.installation=installation;self.key=Ed25519PrivateKey.from_private_bytes(bytes.fromhex(private));self.lock=threading.Lock()
        with sqlite3.connect(path) as db:
            db.execute('PRAGMA journal_mode=WAL');db.execute('CREATE TABLE IF NOT EXISTS operations(seq INTEGER PRIMARY KEY AUTOINCREMENT,id TEXT UNIQUE,kind TEXT,input_sha TEXT,receipt_sha TEXT)')
    def execute(self,p):
        with self.lock,sqlite3.connect(self.path) as db:
            db.execute('PRAGMA synchronous=FULL');db.row_factory=sqlite3.Row
            if p['action']=='begin':
                if set(p)!={'action','id','kind','input_sha','nonce','issued'}:raise ValueError('begin contract')
                r=db.execute('SELECT * FROM operations WHERE id=?',(p['id'],)).fetchone()
                if r and (r['kind']!=p['kind'] or r['input_sha']!=p['input_sha']):raise ValueError('operation ID input bound')
                if not r:db.execute('INSERT INTO operations(id,kind,input_sha) VALUES(?,?,?)',(p['id'],p['kind'],p['input_sha']))
            elif p['action']=='complete':
                if set(p)!={'action','id','receipt_sha','nonce','issued'}:raise ValueError('complete contract')
                r=db.execute('SELECT * FROM operations WHERE id=?',(p['id'],)).fetchone()
                if not r or (r['receipt_sha'] and r['receipt_sha']!=p['receipt_sha']):raise ValueError('completion mismatch')
                db.execute('UPDATE operations SET receipt_sha=? WHERE id=?',(p['receipt_sha'],p['id']))
            elif p['action']!='proof':raise ValueError('unsupported authority operation')
            db.commit()
            rows=[dict(r) for r in db.execute('SELECT * FROM operations ORDER BY seq')]
            body={'installation':self.installation,'nonce':p['nonce'],'issued':time.time(),'seq':len(rows),'operations':rows,'head':sha(rows)}
            return {'payload':body,'signature':self.key.sign(dump(body).encode()).hex()}

def serve(c):
    store=Store(c['path'],c['installation'],c['private_key'])
    class Handler(BaseHTTPRequestHandler):
        def log_message(self,*args):pass
        def do_POST(self):
            try:
                size=int(self.headers.get('content-length','0'))
                if not 0<size<=65536:raise ValueError('request size')
                raw=self.rfile.read(size);sig=hmac.new(bytes.fromhex(c['secret']),raw,hashlib.sha256).hexdigest()
                if not hmac.compare_digest(sig,self.headers.get('x-signature','')):self.send_error(401);return
                p=json.loads(raw)
                if abs(time.time()-p['issued'])>30:raise ValueError('expired request')
                result=store.execute(p)
                if c.get('evidence'):
                    with store.lock,Path(c['evidence']).open('a',encoding='utf-8') as f:f.write(dump({'request':p,'proof':result})+'\n')
                body=dump(result).encode();self.send_response(200);self.send_header('Content-Type','application/json');self.send_header('Content-Length',str(len(body)));self.end_headers();self.wfile.write(body)
            except (ValueError,KeyError) as e:
                body=str(e).encode();self.send_response(409);self.end_headers();self.wfile.write(body)
    server=ThreadingHTTPServer(('127.0.0.1',0),Handler)
    print(json.dumps({'ready':True,'port':server.server_port}),flush=True);server.serve_forever()
if __name__=='__main__':serve(json.loads(sys.stdin.readline()))
