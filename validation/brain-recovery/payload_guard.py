"""Closed synthetic corpus gate. Never prints credentials or blocked payloads."""
import hashlib
import json
from pathlib import Path

CORPUS=Path(__file__).with_name('corpus.json')

class PayloadGuard:
    def __init__(self,expected_sha,secrets=(),corpus=CORPUS,expected_count=3):
        raw=corpus.read_bytes()
        if hashlib.sha256(raw).hexdigest()!=expected_sha:raise ValueError('synthetic corpus manifest changed')
        self.manifest=json.loads(raw)
        if self.manifest.get('fixture_only') is not True or len(self.manifest['documents'])!=expected_count:raise ValueError('explicit synthetic corpus required')
        self.allowed={(d['source'],d['version']):d['content'] for d in self.manifest['documents']}
        self.secrets=[value for value in secrets if isinstance(value,str) and len(value)>=12]
    def source(self,payload,content):
        if self.allowed.get((payload['source'],payload['version']))!=content:raise ValueError('source outside closed synthetic allowlist')
        if hashlib.sha256(content.encode()).hexdigest()!=payload['content_sha']:raise ValueError('synthetic content hash mismatch')
        self.prompt(content)
    def prompt(self,value):
        text=value if isinstance(value,str) else json.dumps(value,ensure_ascii=False,default=str)
        if any(secret in text for secret in self.secrets):raise ValueError('credential detected before inference; payload blocked')

if __name__=='__main__':
    raw=CORPUS.read_bytes();digest=hashlib.sha256(raw).hexdigest();guard=PayloadGuard(digest,['local-test-credential-never-send'])
    records=[]
    for d in guard.manifest['documents']:
        record={'source':d['source'],'version':d['version'],'content_sha':hashlib.sha256(d['content'].encode()).hexdigest()}
        guard.source(record,d['content']);records.append(record)
    for source,content in [({'source':'unregistered','version':1,'content_sha':'0'*64},'not an allowed source')]:
        try:guard.source(source,content)
        except ValueError:pass
        else:raise AssertionError('non-allowlisted source was not blocked')
    try:guard.prompt('local-test-credential-never-send')
    except ValueError:pass
    else:raise AssertionError('credential was not blocked')
    evidence={'corpus_sha256':digest,'fixture_only':True,'allowed_documents':records,'unregistered_source':'BLOCKED','credential_in_payload':'BLOCKED','model_calls':0}
    (CORPUS.parent/'payload-preflight.json').write_text(json.dumps(evidence,indent=2),encoding='utf-8')
    print(json.dumps(evidence))
