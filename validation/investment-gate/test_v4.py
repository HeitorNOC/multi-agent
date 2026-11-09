"""Real local Docker isolation controls; encryption test is not physical off-host DR."""
import hashlib,importlib.util,json,secrets,sys,time
from pathlib import Path
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
import pytest

HERE=Path(__file__).resolve().parent;ROOT=HERE.parents[1]
spec=importlib.util.spec_from_file_location('investment_sandbox',ROOT/'validation/decision-qualification/sandbox_gateway.py')
module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)

def test_v4_local_tool_boundary_and_encrypted_recovery():
    gateway=module.Gateway();evidence={'scope':'local Docker fixture; not enterprise MCP, TLS/SSO, independent host or commercial billing'}
    try:
        code='''import os,socket,json
r={'uid':os.getuid(),'secret_env_names':[k for k in os.environ if any(s in k.upper() for s in ['TOKEN','SECRET','PASSWORD','API_KEY'])]}
for path in ['/etc/investment-write-test','/var/run/docker.sock','/host/customer-secret']:
 try:open(path,'w').write('test');r[path]='ALLOWED'
 except OSError as e:r[path]=type(e).__name__
s=socket.socket();s.settimeout(.5)
try:s.connect(('1.1.1.1',443));r['egress']='ALLOWED'
except OSError as e:r['egress']=type(e).__name__
finally:s.close()
print(json.dumps(r))'''
        context={'fixture_only':True};cap=gateway.capability(code,context)
        rejections=0
        for candidate,payload in [(gateway.capability(code,context,expires=0),context),(cap,{'changed':True})]:
            with pytest.raises(PermissionError):gateway.execute(candidate,code,payload)
            rejections+=1
        executed=gateway.execute(cap,code,context);observed=json.loads(executed['stdout'])
        assert executed['exit_code']==0 and observed['uid']==65534 and not observed['secret_env_names']
        assert all(observed[p]!='ALLOWED' for p in ['/etc/investment-write-test','/var/run/docker.sock','/host/customer-secret','egress'])
        with pytest.raises(PermissionError):gateway.execute(cap,code,context)
        rejections+=1
        loop='import subprocess,time;subprocess.Popen(["/bin/sleep","60"]);time.sleep(60)'
        timed=gateway.execute(gateway.capability(loop,{}),loop,{},timeout=3);assert timed['timeout']
        key=AESGCM.generate_key(bit_length=256);data=secrets.token_bytes(64);nonce=secrets.token_bytes(12)
        envelope=nonce+AESGCM(key).encrypt(nonce,data,b'investment-fixture')
        with pytest.raises(Exception):AESGCM(AESGCM.generate_key(bit_length=256)).decrypt(envelope[:12],envelope[12:],b'investment-fixture')
        restored=AESGCM(key).decrypt(envelope[:12],envelope[12:],b'investment-fixture');assert restored==data
        evidence.update(result='PASS_BOUNDED_LOCAL_CONTROLS',image=module.IMAGE,capability_rejections=rejections,observed=observed,child_timeout=timed,
            encrypted_recovery={'wrong_key_rejected':True,'correct_key_recovers':True,'content_sha256':hashlib.sha256(restored).hexdigest(),
                                'off_host_recovery_tested':False},containers_removed=gateway.removed)
    except BaseException as error:evidence.update(result='FAIL',error=repr(error));raise
    finally:
        (HERE/'v4-local.json').write_text(json.dumps(evidence,indent=2),encoding='utf-8')
