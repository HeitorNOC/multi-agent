import time,uuid
import pytest
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
from freshness_authority import Store
def test_attempt_cap_is_server_owned_and_durable(tmp_path):
    k=Ed25519PrivateKey.generate();path=str(tmp_path/'a.sqlite');s=Store(path,'x',k.private_bytes_raw().hex(),{'model':2})
    def p(id):return {'action':'reserve_call','scope':'model','id':id,'nonce':'n','issued':time.time()}
    a=p('one');assert s.execute(a)['payload']['reservation']['number']==1
    assert s.execute(a)['payload']['budgets']['model']['reserved']==1
    s.execute(p('two'))
    with pytest.raises(ValueError,match='exhausted'):s.execute(p('three'))
    with pytest.raises(ValueError,match='contract'):s.execute({**p('three'),'cap':100})
    s=Store(path,'x',k.private_bytes_raw().hex(),{'model':2})
    with pytest.raises(ValueError,match='exhausted'):s.execute(p('three'))
def test_unknown_resolution_cannot_be_changed_to_success(tmp_path):
    k=Ed25519PrivateKey.generate();s=Store(str(tmp_path/'a.sqlite'),'x',k.private_bytes_raw().hex());id=str(uuid.uuid4())
    s.execute({'action':'begin','id':id,'kind':'decision','context':{'owner':'author'},'input_sha':'a'*64,'nonce':'n','issued':time.time()})
    p={'action':'resolve_unknown','id':id,'receipt_sha':'b'*64,'approvers':['board1','board2'],'nonce':'n','issued':time.time()}
    with pytest.raises(ValueError):s.execute({**p,'approvers':['board1','board1']})
    with pytest.raises(ValueError):s.execute({**p,'approvers':['author','board1']})
    assert s.execute(p)['payload']['operations'][0]['outcome']=='closed_unknown'
    assert s.execute(p)['payload']['operations'][0]['outcome']=='closed_unknown'
    with pytest.raises(ValueError,match='mismatch'):s.execute({'action':'complete','id':id,'receipt_sha':'b'*64,'nonce':'n','issued':time.time()})
