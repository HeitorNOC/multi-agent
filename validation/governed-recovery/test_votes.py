from pathlib import Path
import sys
import time

import pytest
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey

sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'concurrent-reconciliation'))
from freshness_authority import Store


def test_business_unknown_needs_two_retained_votes_and_cannot_become_success(tmp_path):
    key=Ed25519PrivateKey.generate().private_bytes_raw().hex()
    store=Store(str(tmp_path/'authority.sqlite'),'fixture',key,{'business':3})
    def call(**payload):return store.execute({**payload,'nonce':'test','issued':time.time()})['payload']
    call(action='reserve_job',id='job-op',scope='business',units=1,input_sha='a'*64,
         context={'owner':'requester','job':'job','before':'f'*64})
    closure={'action':'resolve_unknown','id':'job-op','receipt_sha':'b'*64,'approvers':['board1','board2']}
    with pytest.raises(ValueError,match='votes'):call(**closure)
    vote={'action':'recovery_vote','id':'job-op','actor':'board1','evidence_sha':'c'*64,
          'reason':'Verified unchanged local state, close unknown and retain reservation.'}
    with pytest.raises(ValueError,match='independent'):call(**{**vote,'actor':'requester'})
    first=call(**vote);assert len(first['recovery_votes'])==1
    assert len(call(**vote)['recovery_votes'])==1
    with pytest.raises(ValueError,match='immutable'):call(**{**vote,'reason':'Changed review reason after the first signed approval.'})
    with pytest.raises(ValueError,match='votes'):call(**closure)
    with pytest.raises(ValueError,match='two independent'):call(**{**closure,'approvers':['board1','board1']})
    with pytest.raises(ValueError,match='changed'):call(**{**vote,'actor':'board2','evidence_sha':'d'*64})
    call(**{**vote,'actor':'board2'})
    done=call(**closure)
    assert done['operations'][0]['outcome']=='closed_unknown'
    assert done['budgets']['business']['reserved']==1
    assert call(**closure)['operations'][0]['outcome']=='closed_unknown'
    with pytest.raises(ValueError,match='mismatch'):call(action='complete',id='job-op',receipt_sha='b'*64)
    with pytest.raises(ValueError,match='pending'):call(**vote)


def test_effect_reconciliation_is_distinct_from_unknown_closure(tmp_path):
    store=Store(str(tmp_path/'authority.sqlite'),'fixture',Ed25519PrivateKey.generate().private_bytes_raw().hex())
    def call(**payload):return store.execute({**payload,'nonce':'test','issued':time.time()})['payload']
    call(action='begin',id='effect',kind='business_effect',input_sha='a'*64,context={'owner':'requester','job':'job'})
    completion={'id':'effect','receipt_sha':'b'*64,'approvers':['board1','board2']}
    with pytest.raises(ValueError,match='votes'):call(action='reconcile_effect',**completion)
    for actor in ['board1','board2']:
        call(action='recovery_vote',id='effect',actor=actor,evidence_sha='c'*64,
             reason='Verified provider receipt and known local delta before reconciling effect.')
    with pytest.raises(ValueError,match='votes'):call(action='resolve_unknown',**completion)
    assert call(action='reconcile_effect',**completion)['operations'][0]['outcome']=='reconciled_effect'
    assert call(action='reconcile_effect',**completion)['operations'][0]['outcome']=='reconciled_effect'
    with pytest.raises(ValueError,match='mismatch'):call(action='complete',id='effect',receipt_sha='b'*64)
