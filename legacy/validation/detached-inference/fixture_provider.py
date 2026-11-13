"""Controlled slow inference fixture. No model, no generated semantic-quality evidence."""
import hashlib,hmac,json,os,sqlite3,sys,threading,time
from http.server import BaseHTTPRequestHandler,ThreadingHTTPServer
from pathlib import Path

def main(c):
    path=c['path'];lock=threading.Lock();gates={};crashes=set();unknown=set();active=set()
    with sqlite3.connect(path) as db:
        db.execute('CREATE TABLE IF NOT EXISTS calls(id TEXT PRIMARY KEY,input_sha TEXT,state TEXT,result_json TEXT,runs INTEGER)')
    def event(kind,id):
        with Path(c['events']).open('a',encoding='utf-8') as out:out.write(json.dumps({'event':kind,'id':id,'time':time.time()})+'\n')
    class Handler(BaseHTTPRequestHandler):
        def log_message(self,*args):pass
        def do_POST(self):
            try:
                raw=self.rfile.read(int(self.headers['content-length']))
                if not hmac.compare_digest(hmac.new(bytes.fromhex(c['key']),raw,hashlib.sha256).hexdigest(),self.headers.get('x-signature','')):raise ValueError('auth')
                p=json.loads(raw)
                if abs(time.time()-p['issued'])>30:raise ValueError('expired')
                id=p['id'];action=p['action']
                with lock:
                    if action=='hold':gates[id]=threading.Event();return self.respond({'held':True})
                    if action=='open':gates[id].set();return self.respond({'opened':True})
                    if action=='crash_after_receipt':crashes.add(id);return self.respond({'armed':True})
                    if action=='crash_before_receipt':unknown.add(id);return self.respond({'armed':True})
                    with sqlite3.connect(path) as db:
                        row=db.execute('SELECT input_sha,state,result_json,runs FROM calls WHERE id=?',(id,)).fetchone()
                        if action=='stats':return self.respond({'rows':[list(r) for r in db.execute('SELECT id,state,runs FROM calls ORDER BY id')]})
                        if action=='inference_lookup':return self.respond(json.loads(row[2]) if row and row[2] else {'id':id,'input_sha':row[0] if row else None,'state':'pending_or_unknown' if row else 'absent','active':id in active})
                        if action=='inference_close_unknown':
                            digest=hashlib.sha256(p['input_json'].encode()).hexdigest()
                            if not row or row[0]!=digest:raise ValueError('closure input bound')
                            if row[2]:
                                if row[1]!='closed_unknown':raise ValueError('known result cannot become unknown')
                                return self.respond(json.loads(row[2]))
                            if id in active:raise ValueError('active inference cannot be closed')
                            result={'id':id,'input_sha':digest,'state':'closed_unknown','outcome':'unknown_not_reexecuted'}
                            db.execute("UPDATE calls SET state='closed_unknown',result_json=? WHERE id=?",(json.dumps(result),id));db.commit()
                            return self.respond(result)
                        assert action=='inference_run'
                        digest=hashlib.sha256(p['input_json'].encode()).hexdigest()
                        if row:
                            if row[0]!=digest:raise ValueError('ID input bound')
                            if row[2]:return self.respond(json.loads(row[2]))
                            return self.respond({'id':id,'state':'pending_or_unknown'})
                        db.execute('INSERT INTO calls VALUES(?,?,?,NULL,1)',(id,digest,'admitted'));db.commit()
                    active.add(id);event('started',id)
                gate=gates.get(id)
                if gate and not gate.wait(30):raise ValueError('fixture gate timed out; remains unknown')
                if id in unknown:os._exit(80)
                result={'id':id,'input_sha':digest,'state':'complete','semantic':{'answer':'Controlled fixture response; no semantic model invoked.','native':False}}
                with lock,sqlite3.connect(path) as db:
                    db.execute("UPDATE calls SET state='complete',result_json=? WHERE id=?",(json.dumps(result),id));db.commit();active.discard(id);event('receipt',id)
                    if id in crashes:os._exit(81)
                self.respond(result)
            except (BrokenPipeError,ConnectionResetError):pass
            except Exception as e:self.respond({'error':str(e)},409)
        def respond(self,value,status=200):
            raw=json.dumps(value).encode();self.send_response(status);self.send_header('content-type','application/json');self.send_header('content-length',str(len(raw)));self.end_headers();self.wfile.write(raw)
    server=ThreadingHTTPServer(('127.0.0.1',0),Handler)
    print(json.dumps({'ready':True,'port':server.server_port}),flush=True);server.serve_forever()

if __name__=='__main__':main(json.loads(sys.stdin.readline()))
