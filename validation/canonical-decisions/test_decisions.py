"""Integrated source selection and advice-history experiment. Oracles committed before inference."""
import hashlib,json,re,time,uuid
from datetime import datetime,timezone
from pathlib import Path
import pytest
from harness import Installation,HERE
from protocol import Rejected,request

def test_canonical_source_native_rag_and_immutable_advice():
    s=Installation();started=time.perf_counter();observations=[];decisions=[]
    def now():return datetime.now(timezone.utc).isoformat()
    def mark(name,**v):
        s.evidence['scenarios'].append({'name':name,**v});print('CHECKPOINT '+name,flush=True)
    def deny(fn,status):
        with pytest.raises(Rejected) as e:fn()
        assert e.value.status==status,str(e.value)
    def calls():
        p=s.state/'model-budget.json';return json.loads(p.read_text())['calls'] if p.exists() else 0
    def publish(version,valid,content,source='politica-remoto',domain='publico',actor='analista'):
        raw=f'---\nsource: {source}\nversion: {version}\nvalid_at: {valid}\ndomain: {domain}\n---\n{content}\n'
        p=Path(s.app_config['vault'])/(source+'.md');p.write_text(raw,encoding='utf-8')
        d=s.call(actor,'/drafts',{'path':p.name});s.call('aprovador','/review',{'id':d['id'],'raw_sha':d['raw_sha']})
        return s.call('aprovador','/publish',{'id':d['id']})
    def advise(asof,known,actor='analista',source='politica-remoto',question='Quantos dias por semana de trabalho remoto a política ACME permite?'):
        p={'request_id':str(uuid.uuid4()),'source':source,'question':question,'as_of':asof,'known_at':known}
        response=s.call(actor,'/advise',p);record=json.loads(response['record_json'])
        assert hashlib.sha256(response['record_json'].encode()).hexdigest()==response['sha256']
        decisions.append({'input':p,'envelope':response});(HERE/'evidence/decisions.json').write_text(json.dumps(decisions,ensure_ascii=False,indent=2),encoding='utf-8')
        return p,response,record
    def check(case,record,version,days):
        selected=record['canonical_snapshot'];native=record['response'];text=native.get('llm_response',{}).get('content','')
        expected=f'politica-remoto@v{version}.md';pattern={1:r'um dia|\b1\s+dia',2:r'dois dias|\b2\s+dias',3:r'tr[eê]s dias|\b3\s+dias'}[days]
        checks={'selected_version':selected.get('version')==version,'answer_value':bool(re.search(pattern,text,re.I)),
            'citation':bool(re.search(r'\[\d+\]',text)) and expected in text,
            'native_source':expected in json.dumps(native.get('data',{})),
            'no_other_version_in_native_context':all(f'politica-remoto@v{v}.md' not in json.dumps(native.get('data',{})) for v in (1,2,3) if v!=version),
            'no_private_canary':'SIGILO_' not in json.dumps(record)}
        observations.append({'case':case,'expected_version':version,'expected_days':days,'checks':checks,'answer':text,'record_request':record['request_id']})
        (HERE/'evidence/acceptance.json').write_text(json.dumps(observations,ensure_ascii=False,indent=2),encoding='utf-8')
        print('ACCEPTANCE '+case+' '+str(checks),flush=True)
    try:
        s.start();mark('real_services_identity_and_pretrained_embeddings')
        deny(lambda:request(s.api,'/advise','forged',{}),401)
        before_any=now()
        publish(1,'2026-01-01T00:00:00Z','Desde 1 de janeiro de 2026, a ACME permite na política de trabalho remoto dois dias por semana.')
        publish(2,'2026-03-01T00:00:00Z','Desde 1 de março de 2026, a política de trabalho remoto da ACME permite três dias por semana, substituindo os dois dias anteriores.')
        before_correction=now()
        p1,old,first=advise('2026-02-15T00:00:00Z',before_correction);check('february_known_before_correction',first,1,2)
        _,_,march=advise('2026-03-15T00:00:00Z',before_correction);check('march_known_before_correction',march,2,3)
        mark('editorial_source_selection_and_native_rag_before_retroactive_correction')
        publish(3,'2026-02-01T00:00:00Z','Retificação recebida posteriormente: de 1 de fevereiro até 1 de março de 2026, a política de trabalho remoto da ACME permitia apenas um dia por semana. A partir de 1 de março de 2026 continuam os três dias já publicados.')
        after_correction=now()
        _,_,corrected=advise('2026-02-15T00:00:00Z',after_correction);check('february_known_after_correction',corrected,3,1)
        _,_,unchanged=advise('2026-03-15T00:00:00Z',after_correction);check('march_unchanged_after_correction',unchanged,2,3)
        _,_,january=advise('2026-01-15T00:00:00Z',after_correction);check('january_after_correction',january,1,2)
        before=calls();recovered=s.call('analista','/decisions/'+old['id'],None,method='GET')
        assert recovered==old and calls()==before
        assert s.call('analista','/advise',p1)==old and calls()==before
        deny(lambda:s.call('analista','/advise',{**p1,'question':'outro pedido com mesmo ID'}),409)
        deny(lambda:s.call('financeiro','/decisions/'+old['id'],None,method='GET'),403)
        mark('old_advice_and_provenance_retrieved_exactly_without_regeneration')
        before=calls();_,_,absent=advise('2026-02-15T00:00:00Z',before_any)
        assert absent['response']['abstained'] and not absent['canonical_snapshot']['found'] and calls()==before
        mark('no_published_source_means_abstention_without_model')
        payload={'request_id':str(uuid.uuid4()),'source':'aquisicao','question':'Qual o valor da aquisição SIGILO_AQUISICAO_2026?','as_of':'2026-02-15T00:00:00Z','known_at':now()}
        before=calls();deny(lambda:s.call('analista','/advise',payload),403);assert calls()==before
        publish(1,'2026-01-01T00:00:00Z','A ACME estuda a aquisição sintética SIGILO_AQUISICAO_2026 por R$9.700.000. Não existe transação real.',source='aquisicao',domain='financeiro',actor='financeiro')
        _,private,private_record=advise('2026-02-15T00:00:00Z',now(),actor='financeiro',source='aquisicao',question='Qual o valor do estudo de aquisição SIGILO_AQUISICAO_2026?')
        assert '9.700.000' in private_record['response']['llm_response']['content'] or '9,7' in private_record['response']['llm_response']['content']
        finance=next(p['id'] for p in s.principals if p['name']=='financeiro')
        s.call('aprovador','/admin/revoke',{'principal':finance,'source':'aquisicao'})
        before=calls();deny(lambda:s.call('financeiro','/decisions/'+private['id'],None,method='GET'),403);assert calls()==before
        assert s.call('aprovador','/decisions/'+private['id'],None,method='GET')==private
        mark('current_acl_applies_to_private_advice_and_historical_records')
        permissions=[]
        for operation in ["UPDATE decisions SET record_json='tamper';","DELETE FROM decisions;"]:
            r=s.d('exec','-i',s.pg_name,'psql','-XqAt','-v','ON_ERROR_STOP=1','-U','decision_writer','-d','pilot',input=operation.encode(),check=False)
            error=r.stderr.decode();assert r.returncode!=0 and 'permission denied' in error
            permissions.append({'operation':operation,'exit_code':r.returncode,'error':error})
        (HERE/'evidence/ledger-permissions.json').write_text(json.dumps(permissions,indent=2),encoding='utf-8')
        mark('runtime_sql_role_cannot_update_or_delete_advice_records')
        budget=calls();s.stop_app();s.start_app();assert s.call('analista','/decisions/'+old['id'],None,method='GET')==old and calls()==budget
        deny(lambda:s.call('financeiro','/decisions/'+private['id'],None,method='GET'),403)
        mark('restart_preserves_original_advice_and_revocation_without_model_calls')
        passed=sum(all(row['checks'].values()) for row in observations)
        s.evidence.update(result='PASS' if passed==len(observations) else 'FAIL_ACCEPTANCE',execution_completed=True,
            answer_cases_passed=passed,answer_cases_total=len(observations),elapsed_seconds=time.perf_counter()-started)
        assert passed==len(observations),f'Answer and source acceptance {passed}/{len(observations)}; originals preserved'
    except Exception as e:
        if not s.evidence.get('execution_completed'):s.evidence.update(result='FAIL',error=str(e),elapsed_seconds=time.perf_counter()-started)
        raise
    finally:s.close()
