"""Two-identity reconciliation, crash recovery and retained tombstone integration."""
import json
import os
from pathlib import Path
import secrets
import sqlite3
import sys
import time
import uuid
import psycopg

import pytest

HERE=Path(__file__).resolve().parent
ROOT=HERE.parents[1]
sys.path.insert(0,str(ROOT/'validation/langgraph-retained-flow'))
from test_signed_flow import SignedLab,Rejected,PY
from authority_client import request as signed_request


class RecoveryLab(SignedLab):
    def __init__(self):
        super().__init__();self.state=HERE/'.state'/self.id;self.state.mkdir(parents=True)
        self.evidence_dir=Path(os.environ.get('QUALIFICATION_EVIDENCE_DIR',str(HERE/'evidence')))
        self.evidence['scope']='governed closure of unchanged uncommitted admissions; unknown effects remain fenced'

    def start(self):
        super().start();self.stop_businesses()
        self.tokens['reviewer2']=secrets.token_hex(24)
        self.config['principals'].append({'id':'reviewer2','role':'board','installation':self.id,
                                         'sources':['politica-remoto','aquisicao'],'token':self.tokens['reviewer2']})
        self.start_business()

    def authority(self):
        self.authority_config['caps']={'business':16}
        super().authority()

    def connect_authority(self):
        super().connect_authority();self.stop_businesses()
        self.config['retained']['commitLeaseMs']=2000
        self.start_business()


def test_two_reviewers_reopen_without_replay_or_budget_refund():
    lab=RecoveryLab();started=time.perf_counter()
    def denied(fn,status):
        with pytest.raises(Rejected) as error:fn()
        assert error.value.status==status,str(error.value)
    try:
        lab.start();lab.connect_authority()
        completed=lab.new_signed();lab.run_worker(completed['id'])
        lab.call('board','approve',job=completed['id'],hash=completed['hash'])
        assert lab.run_worker(completed['id'],resume=True)['completed']
        original=lab.call('owner','status',job=completed['id'])['result']
        lab.call('board','revoke',principal='owner',source='aquisicao')
        before=lab.backup('g0-before-unknown-intent');lab.start_business()
        lab.mark('baseline_receipt_and_revocation_ready')

        pending_id=str(uuid.uuid4())
        lab.call('board','retained_fault',target='create')
        try:lab.new_signed(['policy_lookup'],execute=False,maxUnits=1,request_id=pending_id)
        except Exception:pass
        assert lab.business.wait(timeout=8)==77
        lab.stop_businesses();lab.start_business()
        assert not lab.call('board','retained_status')['current']
        denied(lambda:lab.call('owner','recovery_inspect'),403)
        inspection=lab.call('board','recovery_inspect')
        assert inspection['job']==pending_id and inspection['mode']=='unchanged'
        operation=inspection['operation_id'];evidence=inspection['evidence_sha']
        reason='Close only as unknown after verifying unchanged local state; retain all reservation units.'
        lab.mark('unchanged_pending_admission_has_bound_recovery_evidence')

        denied(lambda:lab.call('owner','recovery_propose',operation_id=operation,evidence_sha=evidence,reason=reason),403)
        denied(lambda:lab.call('board','recovery_propose',operation_id=operation,evidence_sha='0'*64,reason=reason),409)
        proposal=lab.call('board','recovery_propose',operation_id=operation,evidence_sha=evidence,reason=reason)
        repeated=lab.call('board','recovery_propose',operation_id=operation,evidence_sha=evidence,reason=reason)
        assert proposal==repeated and len(proposal['votes'])==1
        denied(lambda:lab.call('board','recovery_confirm',operation_id=operation,evidence_sha=evidence),403)
        denied(lambda:lab.call('reviewer2','recovery_confirm',operation_id=operation,evidence_sha='0'*64),409)
        assert not lab.call('board','retained_status')['current']
        lab.mark('owner_stale_evidence_and_same_reviewer_cannot_reopen')

        lab.call('board','recovery_fault')
        try:lab.call('reviewer2','recovery_confirm',operation_id=operation,evidence_sha=evidence)
        except Exception:pass
        assert lab.business.wait(timeout=8)==78
        lab.stop_businesses();lab.start_business()
        prepared=lab.call('reviewer2','recovery_inspect')
        assert prepared['mode']=='prepared' and prepared['evidence_sha']==evidence
        assert not lab.call('board','retained_status')['current']
        denied(lambda:lab.call('board','recovery_confirm',operation_id=operation,evidence_sha=evidence),403)
        closed=lab.call('reviewer2','recovery_confirm',operation_id=operation,evidence_sha=evidence)
        assert closed['kind']=='closed_unknown' and closed['approvers']==['board','reviewer2']
        assert closed['reservation']=='retained_not_refunded'
        assert lab.call('board','retained_status')['current']
        replay=lab.call('reviewer2','recovery_confirm',operation_id=operation,evidence_sha=evidence)
        assert replay==closed
        lab.evidence['closure']=closed
        lab.mark('closure_crash_reconciled_by_original_second_reviewer')

        denied(lambda:lab.new_signed(['policy_lookup'],execute=False,maxUnits=1,request_id=pending_id),409)
        denied(lambda:lab.new_signed(['policy_lookup'],execute=False,maxUnits=2,request_id=pending_id),409)
        denied(lambda:lab.call('owner','status',job=completed['id']),403)
        assert lab.call('board','status',job=completed['id'])['result']==original
        proof=signed_request(lab.authority_client,action='proof')
        assert proof['budgets']['business']['reserved']==5
        assert next(r for r in proof['operations'] if r['id']==operation)['outcome']=='closed_unknown'
        assert len([v for v in proof['recovery_votes'] if v['operation_id']==operation])==2
        lab.mark('closed_request_cannot_replay_or_reset_budget_or_revocation',reserved=5)

        public=lab.new_signed(['policy_lookup'],execute=False,maxUnits=1)
        assert lab.run_worker(public['id'])['completed']
        latest=lab.backup('g1-after-governed-closure')
        lab.activate(before)
        assert not lab.call('board','retained_status')['current']
        denied(lambda:lab.call('owner','state'),503)
        denied(lambda:lab.call('board','recovery_inspect'),503)
        lab.activate(latest,new_postgres=True)
        assert lab.call('board','retained_status')['current']
        denied(lambda:lab.new_signed(['policy_lookup'],execute=False,maxUnits=1,request_id=pending_id),409)
        denied(lambda:lab.call('owner','status',job=completed['id']),403)
        assert lab.call('owner','status',job=public['id'])['result']
        lab.mark('latest_restore_preserves_closure_old_restore_stays_fenced')

        unknown=lab.new_signed(['policy_lookup'],execute=True,maxUnits=3)
        lab.run_worker(unknown['id'])
        lab.call('board','approve',job=unknown['id'],hash=unknown['hash'])
        lab.call('board','fault')
        lab.run_worker(unknown['id'],resume=True,expected=-1)
        assert lab.business.wait(timeout=8)==74
        lab.stop_businesses();lab.start_business()
        assert not lab.call('board','retained_status')['current']
        lab.provider_proc.terminate();lab.provider_proc.wait(timeout=8)
        denied(lambda:lab.call('board','recovery_inspect'),503)
        denied(lambda:lab.call('reviewer2','recovery_confirm',operation_id=operation,evidence_sha=evidence),503)
        proof=signed_request(lab.authority_client,action='proof')
        pending=[r for r in proof['operations'] if r['receipt_sha'] is None]
        assert len(pending)==1 and pending[0]['kind']=='business_effect'
        assert proof['budgets']['business']['reserved']==9
        with sqlite3.connect(lab.state/'provider.sqlite') as provider:
            sends=provider.execute("SELECT key,count(*) FROM requests WHERE action='send' GROUP BY key").fetchall()
            receipts=provider.execute('SELECT count(*) FROM receipts').fetchone()[0]
        assert receipts==2 and len(sends)==2 and all(n==1 for _,n in sends)
        lab.evidence['provider']={'unique_receipts':receipts,'send_counts':dict(sends)}
        lab.evidence['final_retained_state']={'budgets':proof['budgets'],'pending_kind':pending[0]['kind'],'pending_count':1}
        lab.mark('unavailable_external_receipt_keeps_installation_fenced')
        empty_provider,empty_url=lab.service([str(PY),str(ROOT/'validation/integrated-pilot/provider.py')],{'path':str(lab.state/'provider-missing.sqlite'),'secret':lab.provider_key})
        lab.config['provider']=empty_url;lab.stop_businesses();lab.start_business()
        denied(lambda:lab.call('board','recovery_inspect'),503)
        with sqlite3.connect(lab.state/'provider-missing.sqlite') as empty:
            assert empty.execute("SELECT count(*) FROM requests WHERE action='send'").fetchone()[0]==0
        lab.evidence['missing_receipt_lookup']={'rejected':True,'sends':0}
        lab.provider_proc,lab.provider_url=lab.service([str(PY),str(ROOT/'validation/integrated-pilot/provider.py')],{'path':str(lab.state/'provider.sqlite'),'secret':lab.provider_key})
        lab.config['provider']=lab.provider_url;lab.stop_businesses();lab.start_business()
        effect_inspection=lab.call('board','recovery_inspect')
        assert effect_inspection['mode']=='effect_receipt'
        effect_id=effect_inspection['operation_id'];effect_evidence=effect_inspection['evidence_sha']
        effect_reason='Reconcile the independently looked-up durable provider receipt without sending the effect again.'
        denied(lambda:lab.call('board','recovery_confirm',operation_id=effect_id,evidence_sha=effect_evidence,receipt={'fake':'client supplied'}),400)
        lab.call('board','recovery_propose',operation_id=effect_id,evidence_sha=effect_evidence,reason=effect_reason)
        denied(lambda:lab.call('board','recovery_confirm',operation_id=effect_id,evidence_sha=effect_evidence),403)
        lab.call('board','recovery_fault')
        try:lab.call('reviewer2','recovery_confirm',operation_id=effect_id,evidence_sha=effect_evidence)
        except Exception:pass
        assert lab.business.wait(timeout=8)==78
        lab.stop_businesses();lab.start_business()
        assert lab.call('reviewer2','recovery_inspect')['mode']=='prepared'
        reconciled=lab.call('reviewer2','recovery_confirm',operation_id=effect_id,evidence_sha=effect_evidence)
        assert reconciled['kind']=='reconciled_effect'
        assert lab.call('board','retained_status')['current']
        assert lab.run_worker(unknown['id'],resume=True)['completed']
        assert lab.call('owner','status',job=unknown['id'])['result']['receipt']['deliveries']==1
        denied(lambda:lab.call('owner','status',job=completed['id']),403)
        with sqlite3.connect(lab.state/'provider.sqlite') as provider:
            sends=provider.execute("SELECT key,count(*) FROM requests WHERE action='send' GROUP BY key").fetchall()
        assert len(sends)==2 and all(n==1 for _,n in sends)
        proof=signed_request(lab.authority_client,action='proof')
        assert proof['budgets']['business']['reserved']==9
        assert not any(r['receipt_sha'] is None for r in proof['operations'])
        lab.evidence['effect_reconciliation']=reconciled
        lab.evidence['final_retained_state']={'budgets':proof['budgets'],'pending_count':0,'current':True}
        lab.mark('verified_effect_receipt_reconciles_and_langgraph_resumes_without_resend')
        after_effect=lab.backup('g2-after-effect-reconciliation')
        lab.activate(after_effect,new_postgres=True)
        restored_status=lab.call('board','retained_status')
        lab.evidence['second_restore_status']=restored_status
        assert restored_status['current'],restored_status
        with psycopg.connect(lab.dsn) as restored:
            checkpoints=restored.execute('SELECT count(*) FROM checkpoints WHERE thread_id=%s',(lab.id+':'+unknown['id'],)).fetchone()[0]
        assert checkpoints>0
        assert lab.call('owner','status',job=unknown['id'])['result']['receipt']['deliveries']==1
        assert lab.run_worker(unknown['id'],resume=True)['completed']
        replayed=lab.call('reviewer2','recovery_confirm',operation_id=effect_id,evidence_sha=effect_evidence)
        assert replayed==reconciled
        denied(lambda:lab.call('owner','status',job=completed['id']),403)
        final_proof=signed_request(lab.authority_client,action='proof')
        assert final_proof['budgets']['business']['reserved']==9
        with sqlite3.connect(lab.state/'provider.sqlite') as provider:
            sends=provider.execute("SELECT key,count(*) FROM requests WHERE action='send' GROUP BY key").fetchall()
        assert len(sends)==2 and all(n==1 for _,n in sends)
        lab.mark('second_cold_restore_keeps_reconciled_effect_and_actual_checkpoints',restored_checkpoints=checkpoints)
        lab.evidence['result']='PASS_BOUNDED_GOVERNED_RECOVERY'
    except BaseException as error:
        lab.evidence['result']='FAIL';lab.evidence['error']=lab.redact(repr(error));raise
    finally:
        lab.evidence['seconds']=time.perf_counter()-started
        try:lab.cleanup();lab.evidence['disposable_resources_removed']=True
        finally:lab.save()
