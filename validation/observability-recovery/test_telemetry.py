import hashlib,json,pathlib,sqlite3,sys
import pytest
ROOT=pathlib.Path(__file__).resolve().parents[2];sys.path.insert(0,str(ROOT/'demo-enterprise'))
from telemetry import Outbox,reconcile_sources

def test_outbox_replays_after_remote_commit_and_lost_ack(tmp_path):
    seen={};lost=True
    def sender(body):
        nonlocal lost
        if body['event_id'] in seen:assert seen[body['event_id']]==body
        seen[body['event_id']]=body
        if lost:lost=False;raise ConnectionError('ack lost after remote commit')
        return {'event_id':body['event_id']}
    path=tmp_path/'outbox.sqlite';box=Outbox(path,'job',sender)
    with pytest.raises(ConnectionError):box.emit('retrieval_completed',{'capability':'one'})
    with sqlite3.connect(path) as db:assert db.execute('SELECT delivered FROM outbox').fetchone()[0]==0
    Outbox(path,'job',sender).flush()
    assert len(seen)==1
    with sqlite3.connect(path) as db:assert db.execute('SELECT delivered FROM outbox').fetchone()[0]==1

def test_pending_events_and_artifacts_are_scoped_to_job(tmp_path):
    path=tmp_path/'outbox.sqlite';received=[]
    def send(body):received.append(body);return {'event_id':body['event_id']}
    a=Outbox(path,'one',lambda _:(_ for _ in ()).throw(ConnectionError()))
    with pytest.raises(ConnectionError):a.emit('event',{})
    b=Outbox(path,'two',send);b.flush();assert not received
    assert a.artifact('input',{'same':'document'})==b.artifact('input',{'same':'document'})
    with sqlite3.connect(path) as db:assert db.execute('SELECT count(*) FROM artifacts').fetchone()[0]==2

def test_canonical_read_requires_exact_source_version_hash_and_projection():
    text='Approved fictional source';sha=hashlib.sha256(text.encode()).hexdigest()
    row={'source':'policy','version':2,'sha256':sha,'projection_id':'projection-v2','context':'retrieved fragment'}
    source={'source':'policy','version':2,'sha256':sha,'projection':'projection-v2','content':text}
    assert reconcile_sources([row],[source])[0]['canonical_text']==text
    for delta in [{'version':1},{'content':text+' changed'},{'sha256':'0'*64},{'projection':'other'}]:
        with pytest.raises(ValueError):reconcile_sources([row],[{**source,**delta}])
    with pytest.raises(ValueError):reconcile_sources([row],[])
