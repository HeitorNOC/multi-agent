"""Real API infrastructure regression, deliberately zero CLI/model calls."""
import concurrent.futures as cf
import json,time,uuid
from pathlib import Path
from datetime import datetime,timezone
import pytest
from harness import Installation,HERE
from protocol import request,Rejected
from authority_client import request as authority

def test_new_quota_rejection_preserves_history_and_closed_fingerprint_priority():
    s=Installation();started=time.perf_counter();s.parallel_history=True;s.quota_preflight=True;s.retrieval_mode='naive'
    def save(name,v):(HERE/'evidence'/name).write_text(json.dumps(v,ensure_ascii=False,indent=2,default=str),encoding='utf-8')
    def call(api,actor,path,p=None,method=None):return request(api,path,s.token(actor),p,method)
    def deny(fn,status):
        with pytest.raises(Rejected) as e:fn()
        assert e.value.status==status,str(e.value)
    def proof():return authority({k:s.app_config[k] for k in ('freshness_url','freshness_secret','freshness_public','installation')},action='proof')
    try:
        s.start();s.start_peer()
        path=Path(s.app_config['vault'])/'manual.md';path.write_text('---\nsource: manual-aurora\nversion: 1\nvalid_at: 2026-01-01T00:00:00Z\ndomain: publico\n---\nDocumento sintético para regressão de admissão.\n',encoding='utf-8')
        d=s.call('analista','/drafts',{'path':path.name});s.call('controlador','/review',{'id':d['id'],'raw_sha':d['raw_sha']});s.call('controlador','/publish',{'id':d['id']});cut=datetime.now(timezone.utc).isoformat()
        # Valid business API creates an abstention before the source validity; no fixtures insert responses.
        old_input={'request_id':str(uuid.uuid4()),'source':'manual-aurora','question':'Há fonte aprovada para a data consultada?','as_of':'2025-01-01T00:00:00Z','known_at':cut}
        old=s.call('analista','/advise',old_input);assert json.loads(old['record_json'])['response']['abstained']
        pending={**old_input,'request_id':str(uuid.uuid4()),'question':'Intenção a encerrar para testar prioridade de fingerprint.','as_of':'2026-02-01T00:00:00Z'}
        state=Path(s.app_config['state']);(state/'fault-arm.json').write_text(json.dumps({'stage':'after_fresh_intent','instance':s.app_config['instance']}));(state/'fault-reached.json').write_text('{}')
        with cf.ThreadPoolExecutor(1) as pool:
            f=pool.submit(s.call,'analista','/advise',pending)
            for _ in range(300):
                if json.loads((state/'fault-reached.json').read_text()).get('stage')=='after_fresh_intent':break
                if f.done():f.result();raise AssertionError('fault not reached')
                time.sleep(.1)
            else:raise AssertionError('fault deadline')
            s.stop_app()
            with pytest.raises(Exception):f.result(timeout=20)
        deny(lambda:call(s.peer_api,'analista','/advise',pending),503)
        seq=call(s.peer_api,'controlador','/freshness/status',{})['pending'][0]['seq'];i=call(s.peer_api,'auditor','/freshness/inspect',{'seq':seq});e=i['evidence_sha']
        call(s.peer_api,'auditor','/freshness/close-prepare',{'seq':seq,'evidence_sha':e,'reason':'Encerrar como desconhecido sem executar o modelo, para testar recusa de repetição e quota.'})
        call(s.peer_api,'controlador','/freshness/close-confirm',{'seq':seq,'evidence_sha':e});s.start_app()
        assert proof()['budgets']['model']['reserved']==0
        config={k:s.app_config[k] for k in ('freshness_url','freshness_secret','freshness_public','installation')}
        for _ in range(40):authority(config,action='reserve_call',scope='model',id=str(uuid.uuid4()))
        fresh={**pending,'request_id':str(uuid.uuid4()),'question':'Pedido realmente novo para testar quota antes de admission.'};before=proof()['seq']
        for api in [s.api,s.peer_api]:
            deny(lambda:call(api,'analista','/advise',fresh),429)
            deny(lambda:call(api,'analista','/advise',{**pending,'request_id':str(uuid.uuid4())}),409)
        assert proof()['seq']==before and proof()['budgets']['model']['reserved']==40
        assert s.sql("SELECT count(*) FROM decision_admissions WHERE id='"+fresh['request_id']+"'",'pilot')=='0'
        with cf.ThreadPoolExecutor(8) as pool:
            outputs=list(pool.map(lambda n:call(s.api if n%2==0 else s.peer_api,'analista','/decisions/'+old['id'],None,'GET'),range(16)))
        assert all(o==old for o in outputs)
        assert not s.call('controlador','/recovery/status',{})['recovering']
        assert not list((HERE/'evidence').glob('llm-*.jsonl'))
        save('quota-preflight.json',{'new_status':429,'closed_fingerprint_status':409,'history_reads':16,'history_exact':True,'admission_created':False,'authority_seq_unchanged':True,'actual_cli_calls':0,'reserved':40})
        s.evidence.update(result='PASS',execution_completed=True,actual_cli_calls=0,model_reserved=40,elapsed_seconds=time.perf_counter()-started)
    except Exception as e:s.evidence.update(result='FAIL',error=str(e),elapsed_seconds=time.perf_counter()-started);raise
    finally:s.close()
