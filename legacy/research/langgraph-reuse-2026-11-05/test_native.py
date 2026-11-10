"""Directed proof of upstream recovery patterns, not approval of the business ledger."""
import json,sqlite3,subprocess,sys,time
from pathlib import Path
HERE=Path(__file__).resolve().parent;ROOT=HERE.parents[1]
sys.path.insert(0,str(ROOT/'validation/langgraph-business-flow'))
from test_flow import Lab as BaseLab,PY

class Lab(BaseLab):
    def __init__(self):
        super().__init__();self.state=HERE/'.state'/self.id;self.state.mkdir(parents=True)
    def save(self):
        out=HERE/'evidence';out.mkdir(exist_ok=True)
        (out/'results.json').write_text(json.dumps(self.evidence,indent=2),encoding='utf-8')
    def worker(self,mode,**payload):
        c={'mode':mode,'dsn':self.dsn,'store':str(self.state/'supplier.sqlite'),'thread':self.id+':'+mode,**payload}
        proc=subprocess.run([str(PY),str(HERE/'native_worker.py')],input=json.dumps(c),capture_output=True,text=True,encoding='utf-8',cwd=ROOT,timeout=25)
        self.evidence.setdefault('calls',[]).append({'mode':mode,'resume':bool(payload.get('resume')),'exit_code':proc.returncode,'stderr':self.redact(proc.stderr)[-2000:]})
        if payload.get('crash'):assert proc.returncode==88;return
        assert proc.returncode==0,self.redact(proc.stderr)[-2000:]
        return json.loads(proc.stdout)
    def counts(self):
        with sqlite3.connect(self.state/'supplier.sqlite') as db:return dict(db.execute('SELECT * FROM counts'))

def test_native_recovery_patterns_in_new_processes():
    lab=Lab();started=time.perf_counter()
    try:
        lab.start()
        paused=lab.worker('task_interrupt');assert paused['status']=='paused'
        completed=lab.worker('task_interrupt',resume=True)
        assert completed['value']['result']==paused['interrupts'][0]['result'] and lab.counts()['expensive']==1
        lab.mark('completed_task_result_reused_across_process_and_human_interrupt')
        failed=lab.worker('siblings');assert failed['status']=='failed'
        resumed=lab.worker('siblings',resume=True)
        assert resumed['status']=='done' and lab.counts()['a']==1 and lab.counts()['b']==2
        lab.mark('pending_writes_preserve_successful_parallel_node_across_process')
        lab.worker('effect',crash=True);result=lab.worker('effect',resume=True)
        with sqlite3.connect(lab.state/'supplier.sqlite') as db:rows=db.execute('SELECT * FROM effects').fetchall()
        assert len(rows)==1 and result['value']['receipt']==rows[0][1] and lab.counts()['supplier_attempts']==2
        lab.mark('lost_ack_retries_same_key_with_one_fixture_supplier_effect')
        retried=lab.worker('retry');assert retried['value']['result']==3 and lab.counts()['transient']==3
        lab.mark('native_retry_policy_recovers_transient_error')
        lab.evidence.update(result='PASS_BOUNDED_UPSTREAM_PATTERNS',counts=lab.counts(),model_calls=0,
                            production_approved=False,business_read_commit_requalified=False)
    except BaseException as error:lab.evidence.update(result='FAIL',error=lab.redact(repr(error)));raise
    finally:
        lab.evidence['seconds']=time.perf_counter()-started
        try:lab.cleanup();lab.evidence['disposable_resources_removed']=True
        finally:lab.save()
