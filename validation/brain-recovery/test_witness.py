"""Backup certificates must not accept incomplete, stale or rewritten authority heads."""
import sys
import time
from pathlib import Path

import pytest
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey

sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'concurrent-reconciliation'))
from freshness_authority import Store


def test_backup_witness_is_durable_immutable_and_requires_completed_current_head(tmp_path):
    key=Ed25519PrivateKey.generate().private_bytes_raw().hex()
    path=str(tmp_path/'authority.sqlite')
    store=Store(path,'fixture',key)
    def call(action,**payload):
        return store.execute({'action':action,'nonce':'fixture','issued':time.time(),**payload})['payload']
    proof=call('proof')
    certificate={'id':'generation-0','manifest_sha':'a'*64,'head':proof['head'],'inventory_sha':'b'*64,'snapshot_sha':'c'*64}
    bound=call('backup_witness',**certificate)
    assert bound['head']==proof['head'] and bound['seq']==proof['seq']
    assert bound['backups']==[certificate]
    store=Store(path,'fixture',key)
    assert call('backup_witness',**certificate)['backups']==[certificate]
    with pytest.raises(ValueError,match='immutable'):
        call('backup_witness',**{**certificate,'manifest_sha':'d'*64})
    pending=call('begin',id='change',kind='fixture',input_sha='e'*64,context={})
    with pytest.raises(ValueError,match='completed head'):
        call('backup_witness',**{**certificate,'id':'pending','head':pending['head']})
    completed=call('complete',id='change',receipt_sha='f'*64)
    with pytest.raises(ValueError,match='completed head'):
        call('backup_witness',**{**certificate,'id':'stale'})
    assert call('backup_witness',**{**certificate,'id':'current','head':completed['head']})['seq']==1
