"""Retained authority fixture. Independent process/store/key, not part of customer bundle."""
import hashlib,hmac,json,sqlite3,sys,threading,time
from http.server import BaseHTTPRequestHandler,ThreadingHTTPServer
from pathlib import Path
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey

def dump(v):return json.dumps(v,sort_keys=True,ensure_ascii=False,separators=(',',':'),default=str)
def sha(v):return hashlib.sha256(dump(v).encode()).hexdigest()

class Store:
    def __init__(self,path,installation,private,caps=None):
        self.path=path;self.installation=installation;self.key=Ed25519PrivateKey.from_private_bytes(bytes.fromhex(private));self.lock=threading.Lock()
        self.caps=caps or {'model':40,'stress':7}
        with sqlite3.connect(path) as db:
            db.execute('PRAGMA journal_mode=WAL');db.execute('CREATE TABLE IF NOT EXISTS operations(seq INTEGER PRIMARY KEY AUTOINCREMENT,id TEXT UNIQUE,kind TEXT,input_sha TEXT,receipt_sha TEXT,context_json TEXT NOT NULL,outcome TEXT)')
            db.execute('CREATE TABLE IF NOT EXISTS reservations(scope TEXT,id TEXT,number INTEGER,PRIMARY KEY(scope,id),UNIQUE(scope,number))')
    def execute(self,p):
        with self.lock,sqlite3.connect(self.path) as db:
            db.execute('PRAGMA synchronous=FULL');db.row_factory=sqlite3.Row
            if p['action']=='begin':
                if set(p)!={'action','id','kind','input_sha','context','nonce','issued'}:raise ValueError('begin contract')
                r=db.execute('SELECT * FROM operations WHERE id=?',(p['id'],)).fetchone()
                if r and (r['kind']!=p['kind'] or r['input_sha']!=p['input_sha'] or r['context_json']!=dump(p['context'])):raise ValueError('operation ID input bound')
                if not r:db.execute('INSERT INTO operations(id,kind,input_sha,context_json) VALUES(?,?,?,?)',(p['id'],p['kind'],p['input_sha'],dump(p['context'])))
            elif p['action'] in ('complete','resolve_unknown'):
                expected={'action','id','receipt_sha','nonce','issued'}|({'approvers'} if p['action']=='resolve_unknown' else set())
                if set(p)!=expected:raise ValueError('complete contract')
                r=db.execute('SELECT * FROM operations WHERE id=?',(p['id'],)).fetchone()
                outcome='closed_unknown' if p['action']=='resolve_unknown' else 'committed'
                if not r or (r['receipt_sha'] and (r['receipt_sha']!=p['receipt_sha'] or r['outcome']!=outcome)):raise ValueError('completion mismatch')
                if outcome=='closed_unknown':
                    owners=json.loads(r['context_json']).get('owner');a=p['approvers']
                    if len(a)!=2 or len(set(a))!=2 or owners in a:raise ValueError('two independent governance identities required')
                db.execute('UPDATE operations SET receipt_sha=?,outcome=? WHERE id=?',(p['receipt_sha'],outcome,p['id']))
            elif p['action']=='reserve_call':
                if set(p)!={'action','id','scope','nonce','issued'} or p['scope'] not in self.caps:raise ValueError('reservation contract')
                row=db.execute('SELECT number FROM reservations WHERE scope=? AND id=?',(p['scope'],p['id'])).fetchone()
                if not row:
                    number=db.execute('SELECT count(*) FROM reservations WHERE scope=?',(p['scope'],)).fetchone()[0]+1
                    if number>self.caps[p['scope']]:raise ValueError('reservation cap exhausted')
                    db.execute('INSERT INTO reservations VALUES(?,?,?)',(p['scope'],p['id'],number))
            elif p['action']!='proof':raise ValueError('unsupported authority operation')
            db.commit()
            rows=[]
            for r in db.execute('SELECT * FROM operations ORDER BY seq'):
                item=dict(r);item['context']=json.loads(item.pop('context_json'));rows.append(item)
            budgets={scope:{'cap':cap,'reserved':db.execute('SELECT count(*) FROM reservations WHERE scope=?',(scope,)).fetchone()[0]} for scope,cap in self.caps.items()}
            reservation={'scope':p['scope'],'id':p['id'],'number':db.execute('SELECT number FROM reservations WHERE scope=? AND id=?',(p['scope'],p['id'])).fetchone()[0]} if p['action']=='reserve_call' else None
            body={'installation':self.installation,'nonce':p['nonce'],'issued':time.time(),'seq':len(rows),'operations':rows,'head':sha(rows),'budgets':budgets,'reservation':reservation}
            return {'payload':body,'signature':self.key.sign(dump(body).encode()).hex()}

def serve(c):
    store=Store(c['path'],c['installation'],c['private_key'],c.get('caps'))
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
