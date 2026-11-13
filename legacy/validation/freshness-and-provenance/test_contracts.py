import copy,time,uuid
import pytest
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
from freshness_authority import Store
from freshness import verify

def fixture(tmp_path):
    key=Ed25519PrivateKey.generate();s=Store(str(tmp_path/'authority.sqlite'),'lab',key.private_bytes_raw().hex())
    return s,key.public_key().public_bytes_raw().hex()
def test_signed_proof_rejects_replay_and_alteration(tmp_path):
    s,public=fixture(tmp_path);p=s.execute({'action':'proof','nonce':'new'})
    assert verify(p,public,'lab','new')['seq']==0
    for nonce,installation,now in [('old','lab',time.time()),('new','other',time.time()),('new','lab',time.time()+60)]:
        with pytest.raises(ValueError):verify(p,public,installation,nonce,now)
    forged=copy.deepcopy(p);forged['payload']['seq']=100
    with pytest.raises(ValueError,match='signature'):verify(forged,public,'lab','new')
def test_authority_ids_and_completions_are_immutable(tmp_path):
    s,public=fixture(tmp_path);id=str(uuid.uuid4());p={'action':'begin','id':id,'kind':'approval','input_sha':'a'*64,'nonce':'n','issued':time.time()}
    assert s.execute(p)['payload']['seq']==s.execute(p)['payload']['seq']==1
    with pytest.raises(ValueError):s.execute({**p,'input_sha':'b'*64})
    assert s.execute({'action':'proof','nonce':'n'})['payload']['operations'][0]['receipt_sha'] is None
    c={'action':'complete','id':id,'receipt_sha':'c'*64,'nonce':'n','issued':time.time()};s.execute(c);s.execute(c)
    with pytest.raises(ValueError):s.execute({**c,'receipt_sha':'d'*64})
    proof=s.execute({'action':'proof','nonce':'final'});assert verify(proof,public,'lab','final')['operations'][0]['receipt_sha']=='c'*64
