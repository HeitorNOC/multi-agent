"""Investment criteria: red tests are retained as decision evidence, not hidden."""
import concurrent.futures,json,os,sqlite3,subprocess,sys,time
from pathlib import Path
import pytest

HERE=Path(__file__).resolve().parent;ROOT=HERE.parents[1]
sys.path.insert(0,str(ROOT/'validation/detached-inference'))
from test_detached import DetachedLab,PY,Rejected
from authority_client import request as signed_request

class Lab(DetachedLab):
    def __init__(self):
        super().__init__();self.state=HERE/'.state'/self.id;self.state.mkdir(parents=True)
        self.evidence_dir=HERE/'v1-evidence'/self.id;self.evidence_dir.mkdir(parents=True)
    def start(self):
        super().start();self.stop_businesses();self.config['retained']['commitLeaseMs']=1000;self.start_business()
    def worker(self,job):
        config={'api':self.api,'token':self.tokens['worker'],'job':job['id'],'installation':self.id,'dsn':self.dsn,'heartbeat_ms':350,'request_timeout':12}
        proc=subprocess.Popen([str(PY),str(ROOT/'validation/langgraph-business-flow/worker.py')],stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True,encoding='utf-8',cwd=ROOT)
        self.children.append(proc);proc.stdin.write(json.dumps(config)+'\n');proc.stdin.close();proc.stdin=None
        return proc

@pytest.mark.parametrize('stage,reads',[('before_local',0),('after_business',1),('after_receipt',1)])
def test_v1_read_commit_recovery_required(stage,reads):
    lab=Lab()
    try:
        lab.start();job,p,row=lab.admission()
        lab.control('inference_run',row['id'],input_json=row['input_json'])
        lab.call('board','retained_fault',target='read_commit',stage=stage)
        try:lab.call('worker','read_commit',**p)
        except Exception:pass
        lab.business.wait(timeout=5);code=lab.business.returncode
        assert code=={'before_local':77,'after_business':82,'after_receipt':83}[stage]
        assert lab.count_reads(job)==reads
        lab.stop_businesses();lab.start_business()
        status=lab.call('board','retained_status');proof=signed_request(lab.authority_client,action='proof')
        assert not status['current'] and sum(r['receipt_sha'] is None for r in proof['operations'])==1
        try:lab.call('board','recovery_inspect')
        except Rejected as error:recovery={'status':error.status,'reason':str(error)}
        else:recovery={'status':200}
        # Restore the same pending generation into new PostgreSQL and app paths.
        bundle=lab.backup('pending-'+stage);lab.activate(bundle,new_postgres=True)
        after_restore=lab.call('board','retained_status')
        assert not after_restore['current']
        stats=lab.control('stats')['rows'];assert len(stats)==1 and stats[0][2]==1
        lab.evidence.update(result='FAIL_V1_OPERATIONAL_RECOVERY',stage=stage,exit_code=code,reads=reads,
            status=status,recovery=recovery,restored_status=after_restore,provider_executions=stats,
            safety='fenced, no regenerated inference',criterion='qualified operational recovery after this crash')
        assert recovery['status']==200 and after_restore['current'],'V1: read_commit has no qualified recovery procedure; restart/restore remain fenced'
    finally:
        try:lab.cleanup()
        finally:lab.save()

def test_v1_automatic_heartbeat_and_fencing():
    lab=Lab()
    try:
        lab.start();job,p,row=lab.admission();lab.call('worker','release',job=job['id'],worker=p['worker'],epoch=p['epoch'])
        lab.control('hold',row['id']);proc=lab.worker(job);lab.started(row['id'])
        time.sleep(3);assert proc.poll() is None
        lab.control('open',row['id']);out,err=proc.communicate(timeout=15)
        assert proc.returncode==0,lab.redact(err[-2000:]);result=json.loads(out)
        assert result['completed'] and result['heartbeat_count']>=5
        with sqlite3.connect(lab.config['db']) as db:n=db.execute("SELECT count(*) FROM audit WHERE event='lease_renewed'").fetchone()[0]
        time.sleep(.5)
        with sqlite3.connect(lab.config['db']) as db:assert db.execute("SELECT count(*) FROM audit WHERE event='lease_renewed'").fetchone()[0]==n
        second,p,row=lab.admission();lab.call('worker','release',job=second['id'],worker=p['worker'],epoch=p['epoch'])
        lab.control('hold',row['id']);proc=lab.worker(second);lab.started(row['id']);time.sleep(.5)
        lab.call('board','fence',job=second['id'],reason='Investment qualification: worker authority deliberately revoked')
        time.sleep(.5);lab.control('open',row['id']);out,err=proc.communicate(timeout=15)
        assert proc.returncode!=0 and lab.count_reads(second)==0
        assert lab.call('board','retained_status')['current']
        lab.evidence.update(result='PASS_AUTOMATIC_HEARTBEAT_BOUNDED',worker=result,fenced_worker_exit=proc.returncode,late_reads=0,provider_executions=lab.control('stats')['rows'])
    finally:
        try:lab.cleanup()
        finally:lab.save()
