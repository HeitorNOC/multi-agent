import hashlib
import json
from pathlib import Path
import sys
import pytest

ROOT = Path.cwd()
sys.path.insert(0, str(ROOT/'vendor/openagents-audit/workspace/backend'))
sys.path.insert(0, str(Path(__file__).parent))
from tests.conftest import client, db, workspace, setup_database, disable_analytics
from boundary import OwnLayer


def request(run='joint-1', company='A', scopes=('knowledge:read',)):
    return {'run_id': run, 'company_id': company, 'scopes': list(scopes), 'task': 'Explain sales decline with two evidence sources'}


def test_engine_to_collaboration_and_restart(tmp_path, client, workspace, monkeypatch):
    path = tmp_path/'ledger.sqlite'
    layer = OwnLayer(path, client, workspace)
    result = layer.execute(request())
    assert result['status'] == 'completed' and result['event_count'] >= 20
    assert {s['source_id'] for s in result['sources']} == {'sales-A','campaign-A'}
    layer.publish('joint-1')
    # Prove durable dedup across reconstruction; rerunning engine would hit this sentinel.
    layer = OwnLayer(path, client, workspace)
    def forbidden_reexecution(*args, **kwargs):
        raise AssertionError('completed engine must not execute again')
    monkeypatch.setattr('boundary.subprocess.run', forbidden_reexecution)
    assert layer.execute(request()) == result
    layer.publish('joint-1')
    rows = [e for e in layer.poll() if e.get('metadata',{}).get('enterprise_run_id') == 'joint-1']
    assert len(rows) == 1
    assert json.loads(rows[0]['payload']['content'])['sources'] == result['sources']
    denied = client.get('/v1/events', params={'network': workspace['id']}, headers={'X-Workspace-Token': 'invalid-synthetic'})
    assert denied.status_code == 401
    with pytest.raises(ValueError):
        layer.execute({**request(), 'task': 'different intent'})
    (ROOT/'validation/engine-collaboration/evidence/joint.json').write_text(json.dumps({
        'result': 'PASS', 'engine_result': result, 'transport': 'real OpenAgents FastAPI ASGI + SQLite upstream fixture',
        'engine_transport': 'real subprocess / isolated AgentScope venv / JSON IPC',
        'published_events_after_replay': len(rows), 'invalid_token_status': denied.status_code,
        'scope': 'synthetic local contract proof; no production identity, paid model, full brain or external effects'}, indent=2))


@pytest.mark.parametrize('company,scopes', [('B',['knowledge:read']), ('A',[])])
def test_engine_policy_deny(tmp_path, client, workspace, company, scopes):
    layer = OwnLayer(tmp_path/'denied.sqlite', client, workspace)
    result = layer.execute(request('denied', company, scopes))
    assert result['status'] == 'denied' and result['engine_started'] is False
    with pytest.raises(PermissionError):
        layer.publish('denied')


def test_collaboration_retry_does_not_rerun_engine(tmp_path, client, workspace):
    path = tmp_path/'retry.sqlite'
    layer = OwnLayer(path, client, workspace)
    result = layer.execute(request('retry'))
    layer.workspace = {**workspace, 'token': 'invalid-synthetic'}
    with pytest.raises(RuntimeError, match='401'):
        layer.publish('retry')
    layer = OwnLayer(path, client, workspace)
    assert layer.execute(request('retry')) == result
    layer.publish('retry')
    assert len([e for e in layer.poll() if e.get('metadata',{}).get('enterprise_run_id') == 'retry']) == 1


def test_uncertain_execution_is_held(tmp_path, client, workspace):
    layer = OwnLayer(tmp_path/'uncertain.sqlite', client, workspace)
    req = request('uncertain')
    digest = hashlib.sha256(json.dumps(req, sort_keys=True).encode()).hexdigest()
    with layer.connect() as db:
        db.execute('INSERT INTO runs(id,digest,state) VALUES(?,?,?)', ('uncertain',digest,'executing'))
    with pytest.raises(RuntimeError, match='review'):
        layer.execute(req)


def test_ack_loss_exposes_at_least_once_delivery(tmp_path, client, workspace):
    """Failure characterization: the event API does not deduplicate our metadata."""
    layer = OwnLayer(tmp_path/'ack-loss.sqlite', client, workspace)
    layer.execute(request('ack-loss'))
    class LoseAck:
        def post(self, *args, **kwargs):
            response = client.post(*args, **kwargs)
            assert response.status_code == 200
            raise ConnectionError('synthetic response loss after server commit')
    layer.http = LoseAck()
    with pytest.raises(ConnectionError):
        layer.publish('ack-loss')
    layer.http = client
    layer.publish('ack-loss')
    rows = [e for e in layer.poll() if e.get('metadata',{}).get('enterprise_run_id') == 'ack-loss']
    assert len(rows) == 2
    ids = [e['metadata']['event_id'] for e in rows]
    assert len(set(ids)) == 1
    (ROOT/'validation/engine-collaboration/evidence/delivery-ambiguity.json').write_text(json.dumps({
        'scenario': 'OpenAgents accepts event; response lost; own outbox retries',
        'observed_events': len(rows), 'distinct_business_event_ids': len(set(ids)),
        'conclusion': 'at-least-once transport; metadata event_id is not server-side deduplication',
        'required_adaptation': 'durable inbox dedup at every business consumer; transport receipt/reconciliation before claiming stronger delivery'}, indent=2))
