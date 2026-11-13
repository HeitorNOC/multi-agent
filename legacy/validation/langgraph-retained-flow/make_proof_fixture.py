"""Public test proof only. No private key is exported."""
import json
from pathlib import Path
import sys
import time
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey

HERE=Path(__file__).resolve().parent
sys.path.insert(0,str(HERE.parents[0]/'concurrent-reconciliation'))
from freshness_authority import Store

key=Ed25519PrivateKey.generate()
folder=HERE/'.state'/('proof-'+str(time.time_ns()));folder.mkdir(parents=True)
store=Store(str(folder/'test.sqlite'),'proof-fixture',key.private_bytes_raw().hex())
proof=store.execute({'action':'begin','id':'test-one','kind':'test','input_sha':'a'*64,
                     'context':{'integer_valued_float':1.0,'message':'Aprovação empresarial'},'nonce':'public-fixture','issued':time.time()})
(HERE/'proof-fixture.json').write_text(json.dumps({'proof':proof,'public':key.public_key().public_bytes_raw().hex()},ensure_ascii=False),encoding='utf-8')
print('Public Python-signed proof captured; private key not exported')
