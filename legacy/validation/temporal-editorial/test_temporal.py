"""Acceptance experiment: editorial release plus native valid-time and knowledge-time queries."""
import json,re,time
from datetime import datetime,timezone
from pathlib import Path
import pytest
from harness import Installation,HERE
from protocol import Rejected,request

def test_editorial_publication_and_native_temporal_acceptance():
    stack=Installation();start=time.perf_counter();checks=[];releases=[]
    def mark(name,**data):
        stack.evidence['scenarios'].append({'name':name,**data});print('CHECKPOINT '+name,flush=True)
    def deny(fn,status):
        with pytest.raises(Rejected) as e:fn()
        assert e.value.status==status,str(e.value)
    def note(version,valid,body,source='politica-remoto',domain='publico',filename='politica.md'):
        text=f'---\nsource: {source}\nversion: {version}\nvalid_at: {valid}\ndomain: {domain}\n---\n{body}\n'
        (Path(stack.app_config['vault'])/filename).write_text(text,encoding='utf-8');return text
    def release(path='politica.md',actor='analista'):
        draft=stack.call(actor,'/drafts',{'path':path})
        stack.call('aprovador','/review',{'id':draft['id'],'raw_sha':draft['raw_sha']})
        receipt=stack.call('aprovador','/publish',{'id':draft['id']});releases.append(receipt)
        (HERE/'evidence/releases.json').write_text(json.dumps(releases,ensure_ascii=False,indent=2),encoding='utf-8')
        return draft,receipt
    def query(asof,known=None,domain='publico',actor='analista'):
        p={'domain':domain,'query':'ACME política dias remotos por semana','as_of':asof}
        if known:p['known_at']=known
        return stack.call(actor,'/query',p)
    def check(name,response,expected):
        # Score all observations, including failures, without rewriting native facts/dates.
        relevant=[e for e in response['facts'] if e['name']=='REMOTE_POLICY']
        observed={e.get('attributes',{}).get('dias_remotos') for e in relevant}
        passed=observed=={expected}
        row={'name':name,'expected_days':expected,'observed_days':sorted(observed,key=str),'pass':passed,'response':response};checks.append(row)
        print('ACCEPTANCE '+name+' '+('PASS' if passed else 'FAIL'),flush=True)
        (HERE/'evidence/temporal-checks.json').write_text(json.dumps(checks,ensure_ascii=False,indent=2),encoding='utf-8')
    try:
        stack.start();mark('real_graphiti_neo4j_oidc_and_pretrained_embeddings_ready')
        deny(lambda:request(stack.api,'/query','forged',{'domain':'publico','query':'ACME','as_of':'2026-01-15T00:00:00Z'}),401)
        note(1,'2026-01-01T00:00:00Z','Desde 1 de janeiro de 2026, a empresa ACME concede na política PoliticaRemotaACME dois dias de trabalho remoto por semana.')
        draft=stack.call('analista','/drafts',{'path':'politica.md'})
        deny(lambda:stack.call('analista','/publish',{'id':draft['id']}),403)
        deny(lambda:stack.call('aprovador','/publish',{'id':draft['id']}),409)
        deny(lambda:stack.call('analista','/drafts',{'path':'politica.md','role':'board'}),409)
        stack.call('aprovador','/review',{'id':draft['id'],'raw_sha':draft['raw_sha']})
        p1=stack.call('aprovador','/publish',{'id':draft['id']});releases.append(p1)
        before=(stack.state/'model-budget.json').read_bytes()
        replay=stack.call('aprovador','/publish',{'id':draft['id']});assert replay['replayed'] and replay['episode']==p1['episode']
        assert (stack.state/'model-budget.json').read_bytes()==before
        mark('obsidian_compatible_note_requires_review_and_publication_is_replayed_without_reingestion')
        note(2,'2026-03-01T00:00:00Z','Desde 1 de março de 2026, a empresa ACME concede na mesma política PoliticaRemotaACME três dias de trabalho remoto por semana, substituindo os dois dias anteriores.')
        _,p2=release();known_before=datetime.now(timezone.utc).isoformat()
        check('january_after_march_update',query('2026-01-15T00:00:00Z'),2)
        check('february_before_retroactive_correction',query('2026-02-15T00:00:00Z'),2)
        check('march_after_update',query('2026-03-15T00:00:00Z'),3)
        mark('native_policy_update_valid_time_observed')
        note(3,'2026-02-01T00:00:00Z','Retificação aprovada e recebida posteriormente: entre 1 de fevereiro de 2026 e 1 de março de 2026, a empresa ACME concedia na política PoliticaRemotaACME apenas um dia de trabalho remoto por semana, não dois. Desde 1 de março de 2026 continuam vigentes os três dias já publicados.')
        _,p3=release()
        check('january_after_backdated_correction',query('2026-01-15T00:00:00Z'),2)
        check('february_after_backdated_correction',query('2026-02-15T00:00:00Z'),1)
        check('march_unchanged_by_backdated_correction',query('2026-03-15T00:00:00Z'),3)
        check('what_was_known_before_correction_about_february',query('2026-02-15T00:00:00Z',known_before),2)
        mark('retroactive_and_knowledge_time_results_recorded_without_manual_edge_repair')
        note(1,'2026-01-01T00:00:00Z','A empresa ACME estuda adquirir o projeto SIGILO_AQUISICAO_2026 pelo valor sintético de R$9.700.000. Não há transação real.',source='aquisicao',domain='financeiro',filename='aquisicao.md')
        _,private=release('aquisicao.md','financeiro')
        private_response=stack.call('financeiro','/query',{'domain':'financeiro','query':'ACME projeto SIGILO_AQUISICAO_2026 aquisição valor','as_of':'2026-04-01T00:00:00Z'})
        assert 'SIGILO_AQUISICAO_2026' in json.dumps(private_response)
        deny(lambda:query('2026-04-01T00:00:00Z',domain='financeiro'),403)
        public=query('2026-03-15T00:00:00Z');assert 'SIGILO_' not in json.dumps(public)
        finance=next(p['id'] for p in stack.principals if p['name']=='financeiro')
        stack.call('aprovador','/admin/revoke',{'principal':finance,'source':'aquisicao'})
        budget=(stack.state/'model-budget.json').read_bytes()
        deny(lambda:query('2026-04-01T00:00:00Z',domain='financeiro',actor='financeiro'),403)
        assert (stack.state/'model-budget.json').read_bytes()==budget
        deny(lambda:stack.call('analista','/query',{'domain':'publico','query':'ACME','as_of':'2026-03-15T00:00:00Z','group_ids':['financeiro']}),409)
        mark('native_temporal_partition_authorization_and_source_revocation')
        graph=stack.call('aprovador','/admin/graph',{})
        (HERE/'evidence/native-temporal-graph.json').write_text(json.dumps(graph,ensure_ascii=False,indent=2),encoding='utf-8')
        # Restart the actual service: editorial state, publication identities and revoked grants persist.
        stack.stop_app();stack.start_app()
        deny(lambda:query('2026-04-01T00:00:00Z',domain='financeiro',actor='financeiro'),403)
        latest=query('2026-03-15T00:00:00Z');assert 'SIGILO_' not in json.dumps(latest)
        mark('restart_preserves_editorial_canonical_state_and_revocation')
        passed=sum(c['pass'] for c in checks)
        stack.evidence.update(result='PASS' if passed==len(checks) else 'FAIL_ACCEPTANCE',execution_completed=True,
            temporal_passed=passed,temporal_total=len(checks),elapsed_seconds=time.perf_counter()-start)
        assert passed==len(checks),f'Native temporal acceptance {passed}/{len(checks)}; all observed facts and dates preserved in evidence'
    except Exception as e:
        if not stack.evidence.get('execution_completed'):stack.evidence.update(result='FAIL',error=str(e),elapsed_seconds=time.perf_counter()-start)
        raise
    finally:stack.close()
