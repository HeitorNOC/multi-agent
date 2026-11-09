"""Local authenticated inference from pinned ONNX weights. No model download or remote code."""
import hashlib,hmac,json,os,sys,threading,time
from http.server import BaseHTTPRequestHandler,ThreadingHTTPServer
from pathlib import Path

def main(c):
    os.environ['HF_HUB_DISABLE_TELEMETRY']='1';os.environ['HF_HUB_OFFLINE']='1'
    from fastembed import TextEmbedding
    from tokenizers import Tokenizer
    from numpy import array
    path=Path(c['weights'])
    expected=json.loads((Path(__file__).resolve().parents[1]/'decision-qualification/evidence/pretrained-embedding.json').read_text(encoding='utf-8'))
    for name,meta in expected['model_files'].items():
        if hashlib.sha256((path/name).read_bytes()).hexdigest()!=meta['sha256']:raise ValueError('pinned model artifact hash mismatch: '+name)
    model=TextEmbedding('sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2',specific_model_path=str(path),local_files_only=True,threads=2)
    tokenizer=Tokenizer.from_file(str(path/'tokenizer.json'));tokenizer.no_truncation();tokenizer.no_padding()
    lock=threading.Lock()
    class Handler(BaseHTTPRequestHandler):
        def log_message(self,*args):pass
        def do_POST(self):
            n=int(self.headers.get('content-length','0'))
            if self.path!='/embed' or not 0<n<=1048576:self.send_error(400);return
            raw=self.rfile.read(n);signature=hmac.new(bytes.fromhex(c['secret']),raw,hashlib.sha256).hexdigest()
            if not hmac.compare_digest(signature,self.headers.get('x-signature','')):self.send_error(403);return
            p=json.loads(raw)
            if abs(time.time()-p['issued'])>30 or not 0<len(p['texts'])<=64:self.send_error(400);return
            with lock:
                lengths=[len(e.ids) for e in tokenizer.encode_batch(p['texts'])]
                start=time.perf_counter();vectors=array(list(model.embed(p['texts']))).tolist()
                observed={'batch':len(vectors),'dimension':384,'max_wordpiece_tokens':max(lengths),
                          'truncated_inputs':sum(x>128 for x in lengths),'seconds':time.perf_counter()-start,
                          'input_hashes':[hashlib.sha256(t.encode()).hexdigest() for t in p['texts']]}
                with Path(c['evidence']).open('a',encoding='utf-8') as f:f.write(json.dumps(observed)+'\n')
            body=json.dumps({'vectors':vectors}).encode();self.send_response(200);self.send_header('content-type','application/json');self.send_header('content-length',str(len(body)));self.end_headers();self.wfile.write(body)
    server=ThreadingHTTPServer(('127.0.0.1',0),Handler)
    print(json.dumps({'ready':True,'port':server.server_port}),flush=True);server.serve_forever()

if __name__=='__main__':main(json.loads(sys.stdin.readline()))
