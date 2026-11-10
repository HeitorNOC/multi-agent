"""Verify the sealed local drill and emit a summary without credentials or prompts."""
import argparse
import hashlib
import json
from pathlib import Path
import sqlite3

from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PublicKey

from bundle import authority_anchor, verify


def read_db(path, sql):
    with sqlite3.connect(path.resolve().as_uri()+'?mode=ro',uri=True) as db:
        return db.execute(sql).fetchall()


def run(root):
    custody=root/'custody'
    transfer=root/'transfer'
    target=root/'target'
    sealed=verify(transfer,custody,(custody/'restore.key').read_bytes())
    key=Ed25519PublicKey.from_public_bytes(bytes.fromhex(sealed['public']))
    checked=0
    found_cut=False
    for line in (custody/'proofs.jsonl').read_text(encoding='utf-8').splitlines():
        row=json.loads(line)
        proof=row['proof']
        raw=proof['payload_json']
        key.verify(bytes.fromhex(proof['signature']),raw.encode())
        body=json.loads(raw)
        assert body==proof['payload'] and body['installation']==sealed['id']
        assert body['nonce']==row['request']['nonce']
        assert hashlib.sha256(proof['operations_json'].encode()).hexdigest()==body['head']
        assert json.loads(proof['operations_json'])==body['operations']
        assert [item['seq'] for item in body['operations']]==list(range(1,body['seq']+1))
        if 'model_slots' in body and authority_anchor(body)==sealed['anchor']:
            found_cut=True
        checked+=1
    assert found_cut

    jobs_at_cut=dict(read_db(transfer/'journey.sqlite','SELECT id,status FROM jobs'))
    jobs_after=dict(read_db(target/'journey.sqlite','SELECT id,status FROM jobs'))
    assert set(jobs_at_cut)==set(jobs_after)
    transitions={old:jobs_after[id] for id,old in jobs_at_cut.items()}
    assert transitions=={'awaiting_approval':'completed','interrupted':'completed',
                         'queued':'awaiting_approval','running':'closed_unknown'}
    initial_effects=dict(read_db(transfer/'journey.sqlite','SELECT job,receipt FROM effects'))
    final_effects=dict(read_db(target/'journey.sqlite','SELECT job,receipt FROM effects'))
    assert len(initial_effects)==1 and len(final_effects)==2 and initial_effects.items()<=final_effects.items()
    slots=dict(read_db(custody/'authority.sqlite','SELECT state,count(*) FROM model_slots GROUP BY state'))
    assert slots=={'completed':12,'closed_unknown':1}
    return {'verified_signatures':checked,'sealed_cut_present_in_transcript':found_cut,
            'job_transitions':transitions,'effect_receipts_preserved':len(initial_effects),
            'effect_receipts_after_approval':len(final_effects),'authority_model_slots':slots}


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('case',type=Path)
    print(json.dumps(run(parser.parse_args().case),ensure_ascii=False,indent=2))
