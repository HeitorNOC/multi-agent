import concurrent.futures
from pathlib import Path
import sys
import time

import pytest
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey

sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'concurrent-reconciliation'))
from freshness_authority import Store


def test_job_budget_is_atomic_bound_and_retained(tmp_path):
    path=str(tmp_path/'authority.sqlite'); key=Ed25519PrivateKey.generate().private_bytes_raw().hex()
    store=Store(path,'fixture',key,{'business':10})
    def request(index):
        return {'action':'reserve_job','scope':'business','id':str(index),'units':3,'input_sha':'a'*64,
                'context':{'job':str(index)},'nonce':'fixture','issued':time.time()}
    def reserve(index):
        try:return store.execute(request(index))['payload']['reservation']
        except ValueError:return None
    with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool:
        admitted=list(pool.map(reserve,range(12)))
    accepted=[i for i,r in enumerate(admitted) if r]
    assert len(accepted)==3
    assert store.execute(request(accepted[0]))['payload']['budgets']['business']['reserved']==9
    with pytest.raises(ValueError,match='input bound'):store.execute({**request(accepted[0]),'units':1})
    with pytest.raises(ValueError,match='contract'):store.execute({**request(99),'cap':100})
    with pytest.raises(ValueError,match='positive'):store.execute({**request(99),'units':True})
    restored=Store(path,'fixture',key,{'business':10})
    with pytest.raises(ValueError,match='exhausted'):restored.execute(request(99))
