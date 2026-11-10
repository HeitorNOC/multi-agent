import concurrent.futures as cf
import hashlib,json,subprocess,time,uuid
from pathlib import Path
from datetime import datetime,timezone
import pytest
from harness import Installation,HERE,PY
from protocol import Rejected,request
from authority_client import request as authority

def test_two_processes_reconcile_and_atomic_attempt_budget():
    s=Installation();started=time.perf_counter();replica=None;peer=None;records=[]
    def save(name,v):(HERE/'evidence'/name).write_text(json.dumps(v,ensure_ascii=False,indent=2,default=str),encoding='utf-8')
    def mark(name,**kw):s.evidence['scenarios'].append({'name':name,**kw});print('CHECKPOINT '+name,flush=True)
    def call(api,actor,path,p=None,method=None):return request(api,path,s.token(actor),p,method)
    def cfg():return {k:s.app_config[k] for k in ('freshness_url','freshness_secret','freshness_public','installation')}
    def proof():return authority(cfg(),action='proof')
    def calls():return proof()['budgets']['model']['reserved']
    def deny(fn,status):
        with pytest.raises(Rejected) as e:fn()
        assert e.value.status==status,str(e.value)
    def payload(question):return {'request_id':str(uuid.uuid4()),'source':'politica-remoto','question':question,'as_of':'2026-02-01T00:00:00Z','known_at':cut}
    def record(p,out):
        assert hashlib.sha256(out['record_json'].encode()).hexdigest()==out['sha256']
        records.append({'input':p,'envelope':out});save('decisions.json',records)
    def start_peer():
        return s.process('application',{**s.app_config,'instance':uuid.uuid4().hex},s.app_env)
    def fault(p,stage):
        state=Path(s.app_config['state']);(state/'fault-arm.json').write_text(json.dumps({'stage':stage,'instance':s.app_config['instance']}));(state/'fault-reached.json').write_text('{}')
        with cf.ThreadPoolExecutor(1) as pool:
            f=pool.submit(s.call,'analista','/advise',p)
            for _ in range(900):
                if json.loads((state/'fault-reached.json').read_text()).get('stage')==stage:break
                if f.done():f.result();raise AssertionError('fault not reached')
                time.sleep(.2)
            else:raise AssertionError('fault deadline')
            s.stop_app()
            with pytest.raises(Exception) as e:f.result(timeout=20)
            save('disconnect-'+stage+'.json',{'type':type(e.value).__name__,'message':str(e.value)})
        # The already-running peer must detect the pending operation after acquiring PG lock.
        deny(lambda:call(peer,'analista','/advise',p),503)
        status=call(peer,'auditor','/freshness/status',{})
        assert len(status['pending'])==1
        return status['pending'][0]['seq']
    try:
        save('protocol.json',{'provider':'gpt-6.1-terra','live_attempt_cap':40,'reservation_stress_cap':7,'replicas':2,'identical_requests':8,
            'recovery_windows':['after_fresh_receipt','after_receipt','after_fresh_intent'],'no_external_actions':True,
            'scope':'PG session exclusion serializes business operations; 2 OS probe processes reserve concurrently, no inference in stress scope; attempt count is not money'})
        s.start()
        raw='---\nsource: politica-remoto\nversion: 1\nvalid_at: 2026-01-01T00:00:00Z\ndomain: publico\n---\nA equipe Aurora tem dois dias remotos por semana. O projeto se chama Horizonte. O teto diário de alimentação é R$ 240. O prazo de comprovantes é 18h30 do dia útil seguinte. Despesas extraordinárias exigem dois revisores distintos.\n'
        path=Path(s.app_config['vault'])/'manual.md';path.write_text(raw,encoding='utf-8')
        d=s.call('analista','/drafts',{'path':path.name})
        # Verify current grants for editorial acts, including before any authority intent.
        board=next(p['id'] for p in s.principals if p['name']=='aprovador')
        s.call('auditor','/admin/revoke',{'principal':board,'source':'politica-remoto'});seq=proof()['seq']
        deny(lambda:s.call('aprovador','/review',{'id':d['id'],'raw_sha':d['raw_sha']}),403);assert proof()['seq']==seq
        s.call('auditor','/review',{'id':d['id'],'raw_sha':d['raw_sha']})
        deny(lambda:s.call('aprovador','/publish',{'id':d['id']}),403)
        s.call('auditor','/publish',{'id':d['id']});cut=datetime.now(timezone.utc).isoformat()
        warm=payload('Como se chama o projeto da equipe Aurora?');original=s.call('analista','/advise',warm);record(warm,original)
        replica,peer=start_peer();assert replica.pid!=s.app.pid
        mark('two_api_processes_and_editorial_grant_revocation_enforced')
        p=payload('Quantos dias remotos a equipe Aurora pode fazer por semana?');before=calls()
        with cf.ThreadPoolExecutor(8) as pool:outputs=list(pool.map(lambda n:call(s.api if n%2==0 else peer,'analista','/advise',p),range(8)))
        assert all(out==outputs[0] for out in outputs)
        assert s.sql("SELECT count(*) FROM decisions WHERE id='"+p['request_id']+"'",'pilot')=='1'
        assert s.sql("SELECT count(*) FROM decision_admissions WHERE id='"+p['request_id']+"'",'pilot')=='1'
        record(p,outputs[0]);mark('eight_identical_requests_across_two_processes_one_admission_and_result',model_attempts=calls()-before)
        # Both API processes also execute distinct requests, preserving unique provider call IDs.
        different=[payload('Qual é o teto diário de alimentação?'),payload('Qual o horário limite para envio de comprovantes?')]
        with cf.ThreadPoolExecutor(2) as pool:
            fs=[pool.submit(call,s.api if i==0 else peer,'analista','/advise',p) for i,p in enumerate(different)]
            for p,f in zip(different,fs):record(p,f.result())
        mark('distinct_requests_from_both_api_processes_complete_without_call_id_collision')
        for stage,question in [('after_fresh_receipt','Quantos revisores distintos aprovam despesas extraordinárias?'),('after_receipt','Qual o nome do projeto e o teto de alimentação da equipe Aurora?')]:
            p=payload(question);seq=fault(p,stage);b=calls()
            deny(lambda:call(peer,'analista','/freshness/reconcile',{'seq':seq}),403)
            deny(lambda:call(peer,'aprovador','/freshness/reconcile',{'seq':seq}),403)
            assert call(peer,'auditor','/freshness/reconcile',{'seq':seq})['matches']
            out=call(peer,'analista','/advise',p);record(p,out)
            assert call(peer,'auditor','/freshness/reconcile',{'seq':seq})['matches'] and calls()==b
            s.start_app();assert s.call('analista','/decisions/'+out['id'],None,method='GET')==out
            mark('governance_reconciles_'+stage+'_without_model_or_changed_response')
        pending=payload('Qual o procedimento para solicitar um trabalho remoto extraordinário?');b=calls();seq=fault(pending,'after_fresh_intent');assert calls()==b
        inspected=call(peer,'auditor','/freshness/inspect',{'seq':seq});save('unknown-inspection.json',inspected)
        deny(lambda:call(peer,'auditor','/freshness/reconcile',{'seq':seq}),503)
        proposal={'seq':seq,'reason':'Intenção persistida e processo interrompido; resultado original desconhecido, sem repetição ou declaração de sucesso.','evidence_sha':inspected['evidence_sha']}
        deny(lambda:call(peer,'analista','/freshness/close-prepare',proposal),403)
        deny(lambda:call(peer,'auditor','/freshness/close-prepare',{**proposal,'evidence_sha':'0'*64}),409)
        call(peer,'auditor','/freshness/close-prepare',proposal)
        confirm={'seq':seq,'evidence_sha':inspected['evidence_sha']}
        deny(lambda:call(peer,'auditor','/freshness/close-confirm',confirm),403)
        # Original board grant was revoked: it cannot be used as second authorizer.
        deny(lambda:call(peer,'aprovador','/freshness/close-confirm',confirm),403)
        closed=call(peer,'controlador','/freshness/close-confirm',confirm)
        assert closed['outcome']['original_outcome']=='unknown_not_reexecuted' and not closed['recovering']
        assert call(peer,'controlador','/freshness/close-confirm',confirm)==closed and calls()==b
        deny(lambda:call(peer,'analista','/advise',pending),409)
        deny(lambda:call(peer,'analista','/advise',{**pending,'request_id':str(uuid.uuid4())}),409)
        assert s.sql("SELECT count(*) FROM decisions WHERE id='"+pending['request_id']+"'",'pilot')=='0'
        save('closed-unknown.json',closed);s.start_app();assert s.call('analista','/advise',warm)==original
        mark('two_governance_identities_close_unknown_intent_without_success_or_reexecution')
        # Stress reservations from two independent OS processes, no model inference here.
        config=cfg()
        def probe():
            r=subprocess.run([str(PY),'-X','utf8',str(HERE/'budget_probe.py')],input=json.dumps(config),capture_output=True,text=True,encoding='utf-8',timeout=60)
            assert r.returncode==0,r.stderr;return json.loads(r.stdout)
        with cf.ThreadPoolExecutor(2) as pool:probes=list(pool.map(lambda _:probe(),range(2)))
        all_rows=sum(probes,[]);granted=[r for r in all_rows if r['granted']]
        assert len(all_rows)==20 and len(granted)==7 and {r['number'] for r in granted}==set(range(1,8))
        one=granted[0];again=authority(config,action='reserve_call',scope='stress',id=one['id']);assert again['reservation']['number']==one['number'] and again['budgets']['stress']['reserved']==7
        save('budget-stress.json',{'process_results':probes,'idempotent_retry':again['reservation']})
        mark('two_process_reservation_race_twenty_requests_exactly_seven_admitted')
        b=calls();s.stop_app();replica.terminate();replica.wait(timeout=10);s.freshness_service.terminate();s.freshness_service.wait(timeout=10)
        s.freshness_service,s.freshness_url=s.process('freshness_authority',{'path':str(s.state/'retained-authority.sqlite'),'installation':s.id,'private_key':s.freshness_private,'secret':s.freshness_secret,'caps':{'model':40,'stress':7},'evidence':str(HERE/'evidence/freshness-requests.jsonl')})
        s.start_app();replica,peer=start_peer()
        assert proof()['budgets']['stress']['reserved']==7 and calls()==b
        assert s.call('analista','/advise',warm)==original and call(peer,'analista','/advise',warm)==original and calls()==b
        deny(lambda:call(peer,'analista','/advise',pending),409)
        save('final-proof.json',proof());mark('authority_and_both_clients_restart_preserve_limits_tombstone_and_original_results')
        s.evidence.update(result='PASS',execution_completed=True,model_calls=calls(),elapsed_seconds=time.perf_counter()-started)
    except Exception as e:s.evidence.update(result='FAIL',error=str(e),elapsed_seconds=time.perf_counter()-started);raise
    finally:s.close()
