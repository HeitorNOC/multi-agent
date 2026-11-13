"""Bounded local tool gateway experiment. Does not supply runtime credentials to code."""
import hashlib,hmac,json,secrets,subprocess,time,uuid
from pathlib import Path

HERE=Path(__file__).resolve().parent
IMAGE='mcr.microsoft.com/playwright@sha256:eff16c30e6f3f4af0a03fa4b706120d5e9b0891c344a27d64559aff5900a4a27'

def sign(key,payload):return hmac.new(key,json.dumps(payload,sort_keys=True).encode(),hashlib.sha256).hexdigest()

class Gateway:
    def __init__(self):self.key=secrets.token_bytes(32);self.used=set();self.prefix='decision-tool-'+uuid.uuid4().hex[:10];self.removed=[]
    def capability(self,code,context,**overrides):
        p={'id':secrets.token_hex(12),'expires':time.time()+30,'operation':'python-readonly',
           'payload_sha':hashlib.sha256(json.dumps([code,context],sort_keys=True).encode()).hexdigest(),**overrides}
        return {'payload':p,'signature':sign(self.key,p)}
    def execute(self,cap,code,context,timeout=10):
        p=cap['payload']
        if not hmac.compare_digest(cap['signature'],sign(self.key,p)):raise PermissionError('capability signature')
        if p['operation']!='python-readonly' or p['expires']<time.time() or p['id'] in self.used:raise PermissionError('scope expiry or replay')
        if p['payload_sha']!=hashlib.sha256(json.dumps([code,context],sort_keys=True).encode()).hexdigest():raise PermissionError('payload changed')
        self.used.add(p['id']);name=self.prefix+'-'+str(len(self.used));proc=None
        args=['docker','run','--name',name,'--label','audit.owner='+self.prefix,'-i','--network','none','--read-only','--user','65534:65534',
              '--cap-drop','ALL','--security-opt','no-new-privileges=true','--pids-limit','32','--memory','128m','--memory-swap','128m',
              '--cpus','0.5','--tmpfs','/tmp:rw,noexec,nosuid,nodev,size=16m','--ulimit','nofile=64:64','--log-driver','none',
              '--entrypoint','/usr/bin/python3',IMAGE,'-c',code]
        try:
            # File-backed output prevents untrusted output from exhausting gateway memory.
            import tempfile
            with tempfile.TemporaryFile() as out,tempfile.TemporaryFile() as err:
                proc=subprocess.Popen(args,stdin=subprocess.PIPE,stdout=out,stderr=err)
                try:proc.communicate(json.dumps(context).encode(),timeout=timeout);timed_out=False
                except subprocess.TimeoutExpired:
                    subprocess.run(['docker','kill',name],capture_output=True,timeout=10);proc.communicate(timeout=10);timed_out=True
                out.seek(0);output=out.read(16385);err.seek(0);error=err.read(16385)
                return {'exit_code':proc.returncode,'timeout':timed_out,'stdout':output[:16384].decode(errors='replace'),
                        'stderr':error[:16384].decode(errors='replace'),'output_truncated':len(output)>16384 or len(error)>16384}
        finally:
            if proc and proc.poll() is None:subprocess.run(['docker','kill',name],capture_output=True,timeout=10);proc.communicate(timeout=10)
            self.removed.append(subprocess.run(['docker','rm','-f',name],capture_output=True,timeout=10).returncode==0)

def main():
    gateway=Gateway();evidence={'image':IMAGE,'scope':'local single-use capability + untrusted Python code in Docker; not a remote MCP gateway or kernel security certification'}
    context={'authorized_document':'Vendas públicas sintéticas: 100000 e 80000','api_url':'http://host.docker.internal:9'}
    code='''import sys,json,os,socket
c=json.load(sys.stdin)
r={'context':c['authorized_document'],'uid':os.getuid(),'credential_names':[x for x in os.environ if any(k in x.upper() for k in ['TOKEN','SECRET','PASSWORD','API_KEY'])]}
for p in ['/var/run/docker.sock','/host/secret.txt','/etc/forbidden']:
 try:
  open(p,'w').write('x');r[p]='ALLOWED'
 except OSError as e:r[p]=type(e).__name__
s=socket.socket();s.settimeout(1)
try:s.connect(('1.1.1.1',443));r['egress']='ALLOWED'
except OSError as e:r['egress']=type(e).__name__
finally:s.close()
print(json.dumps(r))'''
    try:
        valid=gateway.capability(code,context)
        forged=json.loads(json.dumps(valid));forged['payload']['operation']='admin'
        rejected=0
        for cap,payload in [(forged,context),(gateway.capability(code,context,expires=0),context),(valid,{'changed':True})]:
            try:gateway.execute(cap,code,payload);raise AssertionError('unauthorized execution admitted')
            except PermissionError:rejected+=1
        r=gateway.execute(valid,code,context);observed=json.loads(r['stdout'])
        assert r['exit_code']==0 and observed['uid']==65534 and not observed['credential_names'] and observed['egress']!='ALLOWED'
        assert all(observed[p]!='ALLOWED' for p in ['/var/run/docker.sock','/host/secret.txt','/etc/forbidden'])
        try:gateway.execute(valid,code,context);raise AssertionError('replay admitted')
        except PermissionError:rejected+=1
        wait='import subprocess,time;subprocess.Popen(["/bin/sleep","60"]);time.sleep(60)'
        cancelled=gateway.execute(gateway.capability(wait,{}),wait,{},timeout=3)
        assert cancelled['timeout']
        evidence.update(result='PASS',negative_capability_cases=rejected,controls=observed,cancel_with_child=cancelled)
    except Exception as e:evidence.update(result='FAIL',error=str(e));raise
    finally:
        evidence['containers_removed']=gateway.removed
        (HERE/'evidence/sandbox-gateway.json').write_text(json.dumps(evidence,indent=2),encoding='utf-8')
        print(json.dumps({'result':evidence['result'],'containers':len(gateway.removed)}))

if __name__=='__main__':main()
