"""Run only disposable, prefix-owned containers against an existing pinned image."""
import json
from pathlib import Path
import subprocess
import tempfile
import time
import uuid

ROOT=Path(__file__).resolve().parent
IMAGE='mcr.microsoft.com/playwright@sha256:eff16c30e6f3f4af0a03fa4b706120d5e9b0891c344a27d64559aff5900a4a27'
PREFIX='production-audit-sandbox-'+uuid.uuid4().hex[:10]
owned=[]

def docker(*args,timeout=25,check=True):
    result=subprocess.run(['docker',*args],capture_output=True,text=True,encoding='utf-8',timeout=timeout)
    if check and result.returncode:raise RuntimeError(result.stderr)
    return result

def arguments(name,script):
    return ['run','--name',name,'--label','audit.owner='+PREFIX,'--network','none','--read-only','--user','65534:65534',
            '--cap-drop','ALL','--security-opt','no-new-privileges=true','--pids-limit','32','--memory','128m','--memory-swap','128m',
            '--cpus','0.5','--tmpfs','/tmp:rw,noexec,nosuid,nodev,size=16m','--ulimit','nofile=64:64',
            '--entrypoint','/usr/bin/python3',IMAGE,'-c',script]

def run(label,script):
    name=PREFIX+'-'+label;owned.append(name)
    result=docker(*arguments(name,script),check=False)
    inspect=json.loads(docker('inspect',name).stdout)[0]
    return {'exit_code':result.returncode,'stdout':result.stdout,'stderr':result.stderr,
            'state':inspect['State'],'host_config':{k:inspect['HostConfig'][k] for k in ['NetworkMode','ReadonlyRootfs','CapDrop','SecurityOpt','PidsLimit','Memory','MemorySwap','NanoCpus','Privileged','Binds']}}


def main():
    evidence={'image':IMAGE,'profile_scope':'containment on this local Docker Linux VM; not kernel exploit resistance or production isolation certification'}
    try:
        normal=run('controls',r'''
import json,os,socket,subprocess
result={'uid':os.getuid(),'proc_status':{l.split(':')[0]:l.split(':')[1].strip() for l in open('/proc/self/status') if l.startswith(('CapEff:','NoNewPrivs:','Seccomp:'))}}
for path in ['/etc/audit-forbidden','/var/run/docker.sock','/host/secret.txt']:
 try:
  with open(path,'w') as f:f.write('synthetic')
  result[path]='WRITE_ALLOWED'
 except OSError as e:result[path]=type(e).__name__
s=socket.socket();s.settimeout(1)
try:s.connect(('1.1.1.1',443));result['egress']='CONNECTED'
except OSError as e:result['egress']=type(e).__name__
finally:s.close()
with open('/tmp/noexec-test','w') as f:f.write('#!/bin/sh\nexit 0\n')
os.chmod('/tmp/noexec-test',0o755)
try:subprocess.run(['/tmp/noexec-test'],check=True);result['tmp_exec']='ALLOWED'
except OSError as e:result['tmp_exec']=type(e).__name__
for name in ['memory.max','pids.max','cpu.max']:
 try:result[name]=open('/sys/fs/cgroup/'+name).read().strip()
 except OSError:result[name]='unavailable'
print(json.dumps(result))
''')
        data=json.loads(normal['stdout']);assert normal['exit_code']==0 and data['uid']==65534
        assert data['proc_status']['CapEff']=='0000000000000000' and data['proc_status']['NoNewPrivs']=='1' and data['proc_status']['Seccomp']=='2'
        assert data['egress']!='CONNECTED' and data['tmp_exec']=='PermissionError' and data['/etc/audit-forbidden']!='WRITE_ALLOWED'
        evidence['controls']={**normal,'observed':data}
        pids=run('pids',r'''
import subprocess,json
children=[];denied=False
try:
 for i in range(64):
  try:children.append(subprocess.Popen(['/bin/sleep','10']))
  except OSError:denied=True;break
finally:
 for p in children:p.terminate()
 for p in children:p.wait()
print(json.dumps({'spawned':len(children),'additional_spawn_denied':denied}))
''')
        assert pids['exit_code']==0 and json.loads(pids['stdout'])['additional_spawn_denied'];evidence['pids']=pids
        memory=run('memory',"print('allocation-start',flush=True);x=bytearray(256*1024*1024);print(len(x))")
        assert memory['state']['OOMKilled'] and memory['exit_code']!=0;evidence['memory_limit']=memory
        name=PREFIX+'-cancel';owned.append(name)
        proc=subprocess.Popen(['docker',*arguments(name,"import subprocess,time;subprocess.Popen(['/bin/sleep','60']);print('ready',flush=True);time.sleep(60)")],stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True)
        try:
            deadline=time.monotonic()+15
            while time.monotonic()<deadline:
                state=docker('inspect',name,check=False)
                if state.returncode==0 and json.loads(state.stdout)[0]['State']['Running']:break
                time.sleep(.1)
            else:raise RuntimeError('disposable container not started')
            docker('kill',name);proc.communicate(timeout=10)
            stopped=json.loads(docker('inspect',name).stdout)[0]['State']
            assert stopped['Running'] is False
            evidence['kill_with_child']={'container_stopped':True,'state':stopped}
        finally:
            if proc.poll() is None:docker('kill',name,check=False);proc.communicate(timeout=10)
        a=run('ephemeral-a',"open('/tmp/own-canary','w').write('synthetic-A');print('written')")
        b=run('ephemeral-b',"import os;print(os.path.exists('/tmp/own-canary'))")
        assert a['exit_code']==0 and b['stdout'].strip()=='False'
        evidence['ephemeral_filesystem_isolation']=True
        evidence['result']='PASS'
    except Exception as error:
        evidence['result']='FAIL';evidence['error']=str(error);raise
    finally:
        cleanup=[]
        for name in owned:
            assert name.startswith(PREFIX+'-')
            cleanup.append({'name':name,'removed':docker('rm','-f',name,check=False).returncode==0})
        evidence['cleanup']=cleanup
        (ROOT/'evidence/sandbox.json').write_text(json.dumps(evidence,indent=2),encoding='utf-8')
        print(json.dumps({'result':evidence['result'],'containers':len(owned)}))


if __name__=='__main__':main()
