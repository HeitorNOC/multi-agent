"""One stateful end-to-end restore experiment, with named acceptance checkpoints."""
import hashlib,json,time
from pathlib import Path
import pytest
from harness import Installation,HERE
from protocol import request,Rejected


def test_integrated_installation_and_joint_restore():
    stack=Installation();started=time.perf_counter()
    def mark(name,**details):
        stack.evidence['scenarios'].append({'name':name,**details});print('CHECKPOINT '+name,flush=True)
        (HERE/'evidence/progress.json').write_text(json.dumps({'last':name,'elapsed_seconds':time.perf_counter()-started},indent=2))
    def denied(action,status):
        with pytest.raises(Rejected) as error:action()
        assert error.value.status==status,str(error.value)
    try:
        print('PROVISIONING isolated PostgreSQL/Neo4j/Keycloak',flush=True)
        stack.start();mark('real_services_and_oidc_ready',versions=stack.evidence['versions'])
        corpus=json.loads((HERE/'corpus/manifest.json').read_text(encoding='utf-8'))['generations']
        published=stack.call('aprovador','/admin/publish',{'generation':'g1','documents':corpus['g1']})
        assert published['documents']==8;mark('journaled_server_backed_generation_g1_published',**published)
        denied(lambda:request(stack.api,'/query','forged-token',{'domains':['publico'],'query':'vendas'}),401)
        denied(lambda:stack.call('analista','/admin/state',{}),403)
        public=stack.call('analista','/query',{'domains':['publico'],'query':'ACME vendas e campanha'})
        assert all(x['domain']=='publico' for x in public['sources'])
        assert 'SIGILO_' not in json.dumps(public)
        assert any(x['id']=='comentario-externo' and x['authority']=='untrusted' for x in public['sources'])
        denied(lambda:stack.call('analista','/query',{'domains':['financeiro'],'query':'aquisição'}),403)
        private=stack.call('financeiro','/query',{'domains':['financeiro'],'query':'ACME aquisição'})
        assert 'SIGILO_AQUISICAO_2026' in json.dumps(private)
        assert any(c['data']['entities'] and c['data']['relationships'] for c in private['context'])
        mark('signed_identity_and_acl_on_actual_hybrid_graph',public_sources=len(public['sources']),private_sources=len(private['sources']))
        denied(lambda:stack.call('analista','/runs',{'intent':'forgery','domains':['publico'],'owner':'other'}),409)
        job=stack.call('analista','/runs',{'intent':'restore-stable-email-intent','domains':['publico']});run=job['id']
        waiting=stack.engine(run)
        assert waiting['next']==['approval']
        state=stack.call('analista','/runs/'+run)
        assert state['state']=='waiting_approval' and state['actual']==2 and state['held']==2
        denied(lambda:stack.call('executor','/runs/'+run+'/effect',{'approved':True}),403)
        denied(lambda:stack.call('analista','/runs/'+run+'/approve',{'plan':state['plan']}),403)
        denied(lambda:stack.call('aprovador','/runs/'+run+'/approve',{'plan':'stale'}),403)
        denied(lambda:stack.call('financeiro','/runs/'+run),403)
        mark('native_pg_checkpoint_human_approval_and_source_injection_fenced',run=run,state=state['state'],synthetic_cost=state['actual'])
        backup=stack.backup();stack.verify_backup()
        assert (backup/'neo4j.dump').exists()
        mark('coherent_cold_backup_pg_graph_objects_and_identity',artifacts=len(stack.evidence['backup_manifest']['files']))
        target=backup/'application-state'/'objects'/next((backup/'application-state'/'objects').iterdir()).name
        original=target.read_bytes()
        try:
            target.write_bytes(original+b'corrupted')
            with pytest.raises(ValueError,match='hash mismatch'):stack.verify_backup()
        finally:target.write_bytes(original)
        stack.verify_backup();mark('backup_tampering_rejected_before_restore')
        stack.call('aprovador','/admin/publish',{'generation':'g2','documents':corpus['g2']})
        current=stack.call('analista','/query',{'domains':['publico'],'query':'política de trabalho remoto'})
        historical=stack.call('analista','/query',{'generation':'g1','domains':['publico'],'query':'política de trabalho remoto'})
        assert next(s['version'] for s in current['sources'] if s['id']=='politica-remoto')==2
        assert next(s['version'] for s in historical['sources'] if s['id']=='politica-remoto')==1
        assert 'versão 2' in json.dumps(current,ensure_ascii=False)
        mark('new_generation_and_explicit_historical_snapshot',active=current['generation'],historical=historical['generation'])
        stack.call('financeiro','/query',{'generation':'g1','domains':['financeiro'],'query':'ACME aquisição'})
        warmed=stack.call('financeiro','/query',{'generation':'g1','domains':['financeiro'],'query':'ACME aquisição'})
        assert warmed['cache_hit'] is True and 'SIGILO_AQUISICAO_2026' in json.dumps(warmed)
        finance=next(p['id'] for p in stack.principals if p['name']=='financeiro')
        stack.call('aprovador','/admin/revoke',{'principal':finance,'source':'aquisicao-reservada'})
        denied(lambda:stack.call('financeiro','/query',{'generation':'g1','domains':['financeiro'],'query':'ACME aquisição'}),403)
        stack.call('financeiro','/query',{'domains':['publico'],'query':'ACME vendas'})
        mark('single_source_revocation_fences_mixed_partition_before_cached_result',cache_was_confirmed_warm=True)
        rebuilt=[dict(d) for d in corpus['g2']]
        for d in rebuilt:
            if d['id']=='aquisicao-reservada':d.update(version=2,content='ACME confidencial: atualização sintética SIGILO_AQUISICAO_2026 versão 2. Não há transação real; a classificação e a revogação de acesso devem permanecer.')
        stack.call('aprovador','/admin/publish',{'generation':'g3','documents':rebuilt})
        denied(lambda:stack.call('financeiro','/query',{'generation':'g3','domains':['financeiro'],'query':'ACME aquisição'}),403)
        mark('source_version_reindex_does_not_regrant_revoked_access')
        fresh=stack.call('analista','/runs/'+run+'/plan',{})
        stack.call('aprovador','/runs/'+run+'/approve',{'plan':fresh['plan']})
        stack.provider_rpc({'action':'fault'})
        stack.engine(run,resume=True,expected=1)
        uncertain=stack.call('analista','/runs/'+run)
        assert uncertain['state']=='effect_pending' and uncertain['actual']==2 and uncertain['result'] is None
        external=stack.provider_rpc({'action':'lookup','key':stack.id+':restore-stable-email-intent:email-v1','digest':fresh['payload'],'run':run})
        assert external['found'] and external['deliveries']==1
        original_receipt=external['receipt']
        mark('external_effect_committed_but_completion_not_falsely_reported',verified_external_deliveries_before_restore=1)
        stack.restore()
        gate=stack.call('aprovador','/admin/state',{})
        assert gate['recovering'] and gate['active']=='g1'
        denied(lambda:stack.call('analista','/query',{'domains':['publico'],'query':'vendas'}),503)
        mark('restored_into_empty_pg_and_graph_volumes_with_recovery_gate_closed')
        recovered=stack.call('aprovador','/admin/recover',{})
        assert recovered['recovered'] and recovered['generation']=='g1'
        denied(lambda:stack.call('financeiro','/query',{'domains':['financeiro'],'query':'aquisição'}),403)
        restored_public=stack.call('analista','/query',{'domains':['publico'],'query':'ACME vendas'})
        assert 'SIGILO_' not in json.dumps(restored_public)
        assert next(s['version'] for s in restored_public['sources'] if s['id']=='politica-remoto')==1
        mark('post_backup_revocation_replayed_and_old_graph_does_not_restore_permission',recovered_sources=recovered['sources_verified'])
        restored_job=stack.call('analista','/runs/'+run)
        assert restored_job['state']=='waiting_approval' and restored_job['actual']==2
        new_plan=stack.call('analista','/runs/'+run+'/plan',{})
        assert new_plan['plan']!=state['plan']
        stack.call('aprovador','/runs/'+run+'/approve',{'plan':new_plan['plan']})
        complete=stack.engine(run,resume=True)
        assert complete['completed'] and complete['next']==[]
        done=stack.call('analista','/runs/'+run)
        assert done['state']=='completed' and done['actual']==3 and done['held']==0
        assert done['result']['deliveries']==1
        assert done['result']['receipt']==original_receipt
        assert stack.sql("SELECT count(*) FROM outbox;",'pilot')=='1'
        assert stack.sql("SELECT count(*) FROM audit WHERE event='knowledge_requested';",'pilot')=='2'
        again=stack.engine(run,resume=True);assert again['own_result_replay']
        assert stack.call('analista','/runs/'+run)['result']['receipt']==done['result']['receipt']
        mark('native_workflow_restored_without_rerunning_reads_or_duplicating_external_effect',deliveries=1,knowledge_calls=2,synthetic_actual=done['actual'],outbox=1)
        stack.evidence['result']='PASS';stack.evidence['elapsed_seconds']=time.perf_counter()-started
    except Exception as error:
        stack.evidence.update(result='FAIL',error=str(error),elapsed_seconds=time.perf_counter()-started);raise
    finally:stack.close()
