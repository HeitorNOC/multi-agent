"""Measure acknowledged admissions missing from the last sealed backup."""
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import os
import shutil
import threading
import time
from uuid import uuid4

from cryptography.hazmat.primitives.ciphers.aead import AESGCM
import pytest

from bundle import authority_anchor, require_current_authority, seal, snapshot_db, verify
from test_host_restore import HERE, ROOT, http
from test_slots import lab


def test_admissions_after_backup_and_advanced_authority(lab):
    """The external oracle records only replies actually received by the client."""
    class Runtime(BaseHTTPRequestHandler):
        def log_message(self,*args):pass

        def do_POST(self):
            request=json.loads(self.rfile.read(int(self.headers['content-length'])))
            assert self.headers.get('x-demo-token')==lab.secret
            if request['action']=='status':
                status,value=200,{'phase':'ready'}
            else:
                assert request['action']=='worker_config'
                status,value=503,{'error':'workers paused for the admission-only drill'}
            self.send_response(status)
            self.end_headers()
            self.wfile.write(json.dumps(value).encode())

    server=ThreadingHTTPServer(('127.0.0.1',0),Runtime)
    backend='http://127.0.0.1:'+str(server.server_port)
    threading.Thread(target=server.serve_forever,daemon=True).start()
    source=lab.state/'source'
    target=lab.state/'target'
    bundle=lab.state/'transfer'
    custody=lab.state/'custody'
    for directory in (source,target,bundle,custody):directory.mkdir()
    config={'root':str(ROOT),'backend':backend,'token':lab.secret,'installation':lab.id,
            'queueCapacity':8,'governedModelSlots':True,
            'policyModule':(ROOT/'demo-enterprise/policy.ts').as_uri()}
    command=['node',str(ROOT/'demo/server.ts')]
    oracle=custody/'client-acknowledgments.jsonl'

    def submit(url):
        code,result=http(url,'/api/jobs',{'scenario':'incident'},{'Idempotency-Key':uuid4().hex})
        acknowledged=time.monotonic()
        assert code==202 and result['status']=='queued'
        with oracle.open('a',encoding='utf-8') as stream:
            stream.write(json.dumps({'job':result['id'],'ack':acknowledged})+'\n')
            stream.flush()
            os.fsync(stream.fileno())
        return result['id']

    def restore_into(destination,key):
        metadata=verify(bundle,custody,key)
        require_current_authority(lab.proof(),metadata['anchor'])
        shutil.copyfile(bundle/'journey.sqlite',destination/'journey.sqlite')
        return lab.service(command,{**config,'state':str(destination)})

    try:
        process,api=lab.service(command,{**config,'state':str(source)})
        before={submit(api) for _ in range(4)}
        snapshot_db(source/'journey.sqlite',bundle/'journey.sqlite')
        key=AESGCM.generate_key(bit_length=256)
        seal(bundle,custody,key,{'anchor':authority_anchor(lab.proof())})
        backup_finished=time.monotonic()

        after=set()
        for _ in range(3):
            time.sleep(.2)
            after.add(submit(api))
        process.terminate()
        process.wait(timeout=8)
        outage=time.monotonic()

        recovered_process,restored_api=restore_into(target,key)
        code,state=http(restored_api,'/api/state')
        assert code==200
        assert all(job['status']=='queued' and not job['approval'] and not job['receipt'] for job in state['jobs'])
        restored={job['id'] for job in state['jobs']}
        acknowledgments=[json.loads(line) for line in oracle.read_text(encoding='utf-8').splitlines()]
        missing=[entry for entry in acknowledgments if entry['job'] not in restored]
        assert restored==before
        assert len(acknowledgments)==7 and {entry['job'] for entry in missing}==after
        assert all(backup_finished<entry['ack']<=outage for entry in missing)
        assert lab.proof()['budgets']['model']['reserved']==0
        recovered_process.terminate()
        recovered_process.wait(timeout=8)

        # A later, retained admission must fence this older backup even if its files are intact.
        lab.native('model_slot_run',job=sorted(after)[0],slot='plan',prompt='Reserva fictícia posterior ao backup',limit=1)
        advanced=lab.proof()
        assert advanced['budgets']['model']['reserved']==1 and len(lab.dispatches())==1
        refused=lab.state/'refused'
        refused.mkdir()
        with pytest.raises(ValueError,match='sealed recovery point'):
            restore_into(refused,key)
        assert not list(refused.iterdir())
        assert len(lab.dispatches())==1

        evidence={
            'result':'PASS_LOCAL_RECOVERY_GAP','accepted_at_backup':len(before),
            'acknowledged_at_outage':len(acknowledgments),'restored_admissions':len(restored),
            'acknowledged_admissions_missing':len(missing),
            'seconds_backup_ready_to_process_exit':round(outage-backup_finished,3),
            'missing_ack_seconds_after_backup':[round(entry['ack']-backup_finished,3) for entry in missing],
            'older_backup_rejected_when_authority_advanced':True,
            'dispatched_before_restore':0,'controlled_dispatch_for_fence_probe':1,'paid_model_calls':0,
            'scope':'local admission-only experiment; no inferred production RPO',
        }
        (HERE/f'recovery-gap-{uuid4().hex[:10]}.json').write_text(json.dumps(evidence,indent=2),encoding='utf-8')
    finally:
        server.shutdown()
        server.server_close()
