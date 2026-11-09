from pathlib import Path
import sys
sys.path.insert(0,str(Path(__file__).parent))
from runtime import Store

def p(run='r1',approved=True):return {'companyId':'A','runId':run,'taskId':'task1','intentId':'task1:approved-email-v1','approved':approved,'delayMs':100}
def test_stable_intent_across_retry_and_restart(tmp_path):
 path=tmp_path/'db.sqlite';s=Store(path);a=p();assert s.submit(a);assert s.running(a);assert s.effect(a)==1;s.settle(a,'completed')
 s=Store(path);b=p('r2');assert s.submit(b);assert s.running(b);assert s.effect(b)==0;assert s.status(b)['effects']==1

def test_cancel_tombstone_fences_late_submit(tmp_path):
 s=Store(tmp_path/'db.sqlite');a=p();s.request_cancel(a);assert not s.submit(a);assert not s.running(a);assert s.status(a)['status']=='cancelled';assert s.status(a)['effects']==0

def test_cancellation_cannot_regress_completed(tmp_path):
 s=Store(tmp_path/'db.sqlite');a=p();s.submit(a);s.running(a);s.effect(a);s.settle(a,'completed');s.request_cancel(a);assert s.status(a)['status']=='completed';assert s.status(a)['effects']==1

def test_restart_holds_uncertain_work(tmp_path):
 path=tmp_path/'db.sqlite';s=Store(path);a=p();s.submit(a);s.running(a);s=Store(path);assert s.status(a)['status']=='recovery_required';assert not s.submit(a);assert not s.running(a)
