"""Requalify four red windows with explicit two-person recovery, not auto-success."""
import concurrent.futures,json,pathlib,secrets,sqlite3,sys,time
import pytest
HERE=pathlib.Path(__file__).resolve().parent;ROOT=HERE.parents[1]
sys.path.insert(0,str(ROOT/'validation/investment-gate'))
from test_v1 import Lab as PriorLab,Rejected
from authority_client import request as signed_request

class Lab(PriorLab):
    def __init__(self):
        super().__init__();self.state=HERE/'.state'/self.id;self.state.mkdir(parents=True)
        self.evidence_dir=HERE/'evidence'/self.id;self.evidence_dir.mkdir(parents=True)
        self.tokens['reviewer2']=secrets.token_hex(24)
    def start_business(self):
        if not any(x['id']=='reviewer2' for x in self.config['principals']):
            self.config['principals'].append({'id':'reviewer2','role':'board','installation':self.id,'sources':['politica-remoto','aquisicao'],'token':self.tokens['reviewer2']})
        super().start_business()

def denied(fn,status):
    with pytest.raises(Rejected) as error:fn()
    assert error.value.status==status,str(error.value)

def approve(lab,inspection,crash=False):
    args={'operation_id':inspection['operation_id'],'evidence_sha':inspection['evidence_sha']}
    denied(lambda:lab.call('owner','recovery_inspect'),403)
    denied(lambda:lab.call('board','recovery_propose',**{**args,'evidence_sha':'0'*64},reason='Invalid evidence must never be accepted.'),409)
    lab.call('board','recovery_propose',**args,reason='Verify provider evidence and exact inventory; retain reservations without regenerating inference.')
    denied(lambda:lab.call('board','recovery_confirm',**args),403)
    if crash:
        stage=crash if isinstance(crash,str) else 'after_local'
        lab.call('board','recovery_fault',stage=stage)
        try:lab.call('reviewer2','recovery_confirm',**args)
        except Exception:pass
        assert lab.business.wait(timeout=8)==(79 if stage=='after_provider' else 78)
        lab.stop_businesses();lab.start_business();inspection=lab.call('board','recovery_inspect')
        assert inspection['mode']==('inference_unknown' if stage=='after_provider' else 'prepared') and inspection['evidence_sha']==args['evidence_sha']
    result=lab.call('reviewer2','recovery_confirm',**args)
    assert lab.call('reviewer2','recovery_confirm',**args)==result
    denied(lambda:lab.call('board','recovery_confirm',**args),403)
    assert lab.call('board','retained_status')['current']
    return result

@pytest.mark.parametrize('stage,expected_reads',[('before_local',0),('after_business',1),('after_receipt',1)])
@pytest.mark.parametrize('recovery_crash',[False,True])
def test_read_commit_recovers_receipt_across_restart_restore_and_review_crash(stage,expected_reads,recovery_crash):
    lab=Lab();started=time.perf_counter()
    try:
        lab.start();job,p,row=lab.admission();original=lab.control('inference_run',row['id'],input_json=row['input_json'])
        lab.call('board','retained_fault',target='read_commit',stage=stage)
        try:lab.call('worker','read_commit',**p)
        except Exception:pass
        assert lab.business.wait(timeout=8)=={'before_local':77,'after_business':82,'after_receipt':83}[stage]
        assert lab.count_reads(job)==expected_reads
        lab.stop_businesses();lab.start_business();assert not lab.call('board','retained_status')['current']
        inspection=lab.call('board','recovery_inspect');assert inspection['mode']=='read_receipt'
        pending=lab.backup('pending');lab.activate(pending,new_postgres=True)
        restored=lab.call('board','recovery_inspect');assert restored['evidence_sha']==inspection['evidence_sha']
        if not recovery_crash:
            lab.activate(pending,corrupt=('business.sqlite','UPDATE jobs SET spent=spent+1'))
            denied(lambda:lab.call('board','recovery_inspect'),503)
            lab.activate(pending)
        result=approve(lab,restored,crash=recovery_crash);assert result['kind']=='reconciled_read' and result['receipt']==original
        assert lab.count_reads(job)==1
        denied(lambda:lab.read(p),409)
        fresh=lab.reclaim(job,p);assert lab.read(fresh)['semantic']==original['semantic']
        with sqlite3.connect(lab.config['db']) as db:
            assert db.execute('SELECT spent FROM jobs WHERE id=?',(job['id'],)).fetchone()[0]==1
            assert db.execute('SELECT count(*) FROM charges WHERE job=?',(job['id'],)).fetchone()[0]==1
        latest=lab.backup('recovered');lab.activate(latest,new_postgres=True);assert lab.call('board','retained_status')['current']
        lab.activate(pending);assert not lab.call('board','retained_status')['current']
        denied(lambda:lab.call('board','recovery_inspect'),503)
        lab.activate(latest);assert lab.call('board','retained_status')['current']
        stats=lab.control('stats')['rows'];assert len(stats)==1 and stats[0][2]==1
        proof=signed_request(lab.authority_client,action='proof');assert not any(x['receipt_sha'] is None for x in proof['operations'])
        lab.evidence.update(result='PASS_READ_COMMIT_RECOVERY',stage=stage,recovery_crash=recovery_crash,provider_executions=stats,recovery=result,budgets=proof['budgets'],seconds=time.perf_counter()-started)
    except BaseException as error:lab.evidence.update(result='FAIL',error=lab.redact(repr(error)));raise
    finally:
        try:lab.cleanup()
        finally:lab.save()

def test_active_or_known_inference_cannot_be_closed_as_unknown():
    from urllib.error import HTTPError
    lab=Lab()
    try:
        lab.start();job,p,row=lab.admission();lab.control('hold',row['id'])
        with concurrent.futures.ThreadPoolExecutor(max_workers=1) as pool:
            future=pool.submit(lab.control,'inference_run',row['id'],input_json=row['input_json']);lab.started(row['id'])
            denied(lambda:lab.call('board','recovery_inspect'),503)
            with pytest.raises(HTTPError) as error:lab.control('inference_close_unknown',row['id'],input_json=row['input_json'])
            assert error.value.code==409 and lab.call('board','retained_status')['current']
            lab.control('open',row['id']);assert future.result()['state']=='complete'
        denied(lambda:lab.call('board','recovery_inspect'),503)
        with pytest.raises(HTTPError) as error:lab.control('inference_close_unknown',row['id'],input_json=row['input_json'])
        assert error.value.code==409
        assert lab.control('stats')['rows'][0][2]==1
        lab.evidence.update(result='PASS_ACTIVE_AND_KNOWN_CLOSE_REJECTED')
    except BaseException as error:lab.evidence.update(result='FAIL',error=lab.redact(repr(error)));raise
    finally:
        try:lab.cleanup()
        finally:lab.save()

@pytest.mark.parametrize('recovery_crash',[False,True,'after_provider'])
def test_unknown_is_closed_without_result_refund_or_regeneration(recovery_crash):
    lab=Lab();started=time.perf_counter()
    try:
        lab.start();job,p,row=lab.admission();lab.control('crash_before_receipt',row['id']);denied(lambda:lab.read(p),503)
        assert lab.inference_process.wait(timeout=8)==80
        lab.stop_businesses();lab.inference_service();lab.start_business();fresh=lab.reclaim(job,p)
        for _ in range(3):denied(lambda:lab.read(fresh),409)
        assert lab.call('board','retained_status')['current'] and lab.count_reads(job)==0
        inspection=lab.call('board','recovery_inspect');assert inspection['mode']=='inference_unknown'
        result=approve(lab,inspection,crash=recovery_crash)
        assert result['kind']=='closed_inference_unknown' and result['original_outcome']=='unknown_not_reexecuted' and 'semantic' not in result['receipt']
        status=lab.call('owner','status',job=job['id']);assert status['state']=='closed_unknown' and status['result'] is None
        denied(lambda:lab.read(fresh),409)
        denied(lambda:lab.new_signed(['policy_lookup'],execute=False,maxUnits=1,request_id=job['id']),409)
        assert lab.control('inference_run',row['id'],input_json=row['input_json'])['state']=='closed_unknown'
        proof=signed_request(lab.authority_client,action='proof');assert proof['budgets']['business']['reserved']==1
        with sqlite3.connect(lab.config['db']) as db:assert db.execute('SELECT spent FROM jobs WHERE id=?',(job['id'],)).fetchone()[0]==1
        latest=lab.backup('closed');lab.activate(latest,new_postgres=True);assert lab.call('board','retained_status')['current']
        assert lab.call('owner','status',job=job['id'])['state']=='closed_unknown'
        new=lab.new_signed(['policy_lookup'],execute=False,maxUnits=1);assert lab.run_worker(new['id'])['completed']
        stats=lab.control('stats')['rows'];assert len(stats)==2 and all(x[2]==1 for x in stats)
        lab.evidence.update(result='PASS_UNKNOWN_GOVERNED_CLOSURE',recovery_crash=recovery_crash,recovery=result,provider_executions=stats,budgets=proof['budgets'],seconds=time.perf_counter()-started)
    except BaseException as error:lab.evidence.update(result='FAIL',error=lab.redact(repr(error)));raise
    finally:
        try:lab.cleanup()
        finally:lab.save()
