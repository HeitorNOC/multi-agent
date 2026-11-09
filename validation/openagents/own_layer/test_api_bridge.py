"""Own integration module against the real OpenAgents ASGI API; synthetic DB."""
import json
from pathlib import Path
import sys
backend=Path.cwd()/'vendor/openagents-audit/workspace/backend'
sys.path.insert(0,str(backend))
from tests.conftest import client,db,workspace,setup_database,disable_analytics
class EnterpriseCollaboration:
    def __init__(self,http,workspace):self.http=http;self.workspace=workspace
    def publish(self,content,run_id):
        return self.http.post('/v1/events',json={'type':'workspace.message.posted','source':'openagents:agent-alpha','target':'channel/'+self.workspace['channel']['name'],'payload':{'content':content},'network':self.workspace['id'],'metadata':{'enterprise_run_id':run_id}},headers={'X-Workspace-Token':self.workspace['token']})

def test_own_layer_over_real_event_api(client,workspace):
    layer=EnterpriseCollaboration(client,workspace)
    sent=layer.publish('Synthetic task for our capability controller','synthetic-run-1');assert sent.status_code==200,sent.text
    polled=client.get('/v1/events',params={'network':workspace['id']},headers={'X-Workspace-Token':workspace['token']})
    assert polled.status_code==200
    events=polled.json()['data']['events'];assert any(e.get('metadata',{}).get('enterprise_run_id')=='synthetic-run-1' for e in events)
    denied=client.get('/v1/events',params={'network':workspace['id']},headers={'X-Workspace-Token':'invalid-synthetic'})
    assert denied.status_code==401
    Path('validation/openagents/evidence/own-layer.json').write_text(json.dumps({'result':'PASS','own_layer':'outside upstream repository','boundary':'real FastAPI ASGI event API and real SQLite fixture, no network service','publish_status':sent.status_code,'poll_status':polled.status_code,'trace_metadata_preserved':True,'invalid_token':denied.status_code,'limits':'Workspace legacy token mode only; no cognitive runtime, budget or full enterprise knowledge qualified'},indent=2))
