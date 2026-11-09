import concurrent.futures,hashlib,json,statistics,time
import pytest
from harness import Installation,HERE
from protocol import request,Rejected

def test_freshness_recovery_security_and_bounded_load():
    stack=Installation();started=time.perf_counter();corpus=json.loads((HERE/'corpus/manifest.json').read_text(encoding='utf-8'))['generations']
    def mark(name,**data):
        stack.evidence['scenarios'].append({'name':name,**data});print('CHECKPOINT '+name,flush=True)
    def deny(fn,status):
        with pytest.raises(Rejected) as e:fn()
        assert e.value.status==status,str(e.value)
    def authority(docs,sequence=2,mode='normal',head=None):
        journal=stack.state/'security-journal.jsonl'
        if head is None:head=json.loads(journal.read_text().splitlines()[-1])['signature'] if journal.exists() else ''
        stack.authority_state.write_text(json.dumps({'documents':docs,'sequence':sequence,'mode':mode,'security_head':head}),encoding='utf-8')
    try:
        stack.start();authority(corpus['g1'],1)
        stack.call('aprovador','/admin/publish',{'generation':'g1','documents':corpus['g1']})
        job=stack.call('analista','/runs',{'intent':'external-before-restore','domains':['publico']});run=job['id']
        stack.engine(run);plan=stack.call('analista','/runs/'+run+'/plan',{})
        # Second old run has no receipt: recovery must never emit it later.
        absent=stack.call('analista','/runs',{'intent':'never-executed','domains':['publico']})['id']
        stack.backup();mark('cold_backup_of_real_stack')
        stack.call('aprovador','/runs/'+run+'/approve',{'plan':plan['plan']})
        stack.provider_rpc({'action':'fault'});stack.engine(run,resume=True,expected=1)
        receipt=stack.provider_rpc({'action':'lookup','key':stack.id+':external-before-restore:email-v1','digest':plan['payload'],'run':run})
        assert receipt['found'];mark('external_commit_without_ack_recorded')
        finance=next(p['id'] for p in stack.principals if p['name']=='financeiro')
        stack.call('aprovador','/admin/revoke',{'source':'aquisicao-reservada','principal':finance})
        authority(corpus['g2']);stack.restore()
        for path,payload in [('/query',{'domains':['publico'],'query':'política'}),('/runs',{'intent':'blocked','domains':['publico']}),('/runs/'+run+'/effect',{})]:
            deny(lambda:stack.call('analista',path,payload),503)
        deny(lambda:stack.call('aprovador','/admin/recover',{}),503)
        assert stack.call('aprovador','/admin/state',{})['recovering']
        mark('consistent_old_generation_cannot_open_recovery')
        for mode in ['unavailable','bad-signature','expired','replay','incomplete']:
            authority(corpus['g2'],mode=mode)
            deny(lambda:stack.call('aprovador','/admin/recover',{}),503)
            assert stack.call('aprovador','/admin/state',{})['recovering']
        authority(corpus['g2'],head='missing-security-event')
        deny(lambda:stack.call('aprovador','/admin/recover',{}),503)
        mark('unavailable_forged_expired_replayed_incomplete_and_wrong_security_head_fail_closed',negative_cases=6)
        authority(corpus['g2'])
        deny(lambda:stack.call('analista','/admin/publish',{'generation':'g2','documents':corpus['g2']}),403)
        stack.call('aprovador','/admin/publish',{'generation':'g2','documents':corpus['g2']})
        recovered=stack.call('aprovador','/admin/recover',{})
        assert recovered['generation']=='g2' and recovered['verified_sequence']==2
        deny(lambda:stack.call('financeiro','/query',{'domains':['financeiro'],'query':'aquisição'}),403)
        response=stack.call('analista','/query',{'domains':['publico'],'query':'política'})
        assert next(x['version'] for x in response['sources'] if x['id']=='politica-remoto')==2
        historical=stack.call('analista','/query',{'generation':'g1','domains':['publico'],'query':'ACME política vendas campanha'})
        (HERE/'evidence/model-context.json').write_text(json.dumps({'current':response,'historical':historical},ensure_ascii=False,indent=2),encoding='utf-8')
        mark('upstream_reconciliation_republishes_current_policy_and_preserves_revocation')
        deny(lambda:stack.call('aprovador','/runs/'+run+'/approve',{'plan':plan['plan']}),403)
        deny(lambda:stack.call('executor','/runs/'+run+'/effect',{}),403)
        deny(lambda:stack.call('executor','/runs/'+run+'/reconcile',{}),403)
        denied_receipt=stack.call('aprovador','/runs/'+run+'/reconcile',{})
        assert denied_receipt['result']['receipt']==receipt['receipt'] and denied_receipt['held']==0
        deny(lambda:stack.call('aprovador','/runs/'+absent+'/reconcile',{}),409)
        stack.call('aprovador','/runs/'+run+'/reconcile',{})
        mark('historical_runs_lookup_only_existing_receipt_and_no_send_for_missing_receipt')
        # Complete a fresh generation run through the same native workflow.
        fresh=stack.call('analista','/runs',{'intent':'new-current-decision','domains':['publico']})['id']
        stack.engine(fresh);p=stack.call('analista','/runs/'+fresh+'/plan',{})
        stack.call('aprovador','/runs/'+fresh+'/approve',{'plan':p['plan']});stack.engine(fresh,resume=True)
        assert stack.call('analista','/runs/'+fresh)['state']=='completed'
        mark('new_decision_uses_current_generation_native_workflow')
        authority(corpus['g2'],3)
        deny(lambda:stack.call('analista','/query',{'domains':['publico'],'query':'política'}),503)
        assert stack.call('aprovador','/admin/state',{})['recovering']
        stack.call('aprovador','/admin/recover',{})
        mark('later_authority_sequence_change_closes_gate_again')
        from human_oidc import run as human_flow
        human=human_flow(stack);stack.evidence['human_oidc']=human
        mark('local_human_oidc_pkce_and_application_revocation',**human)
        token=stack.token('analista')
        def query(i):
            t=time.perf_counter();r=request(stack.api,'/query',token,{'domains':['publico'],'query':'ACME vendas '+str(i%4)})
            assert 'SIGILO_' not in json.dumps(r)
            return time.perf_counter()-t
        t=time.perf_counter()
        with concurrent.futures.ThreadPoolExecutor(max_workers=5) as pool:latencies=list(pool.map(query,range(40)))
        ordered=sorted(latencies)
        stack.evidence['small_load']={'requests':40,'concurrency':5,'errors':0,'p50_seconds':statistics.median(latencies),'p95_seconds':ordered[37],
                                      'elapsed_seconds':time.perf_counter()-t,'scope':'mixed warm/cold retrieval; synthetic embeddings; no model calls'}
        mark('bounded_retrieval_load_no_acl_leak',**stack.evidence['small_load'])
        jobs=[stack.call('analista','/runs',{'intent':'capacity-'+str(i),'domains':['publico']})['id'] for i in range(32)]
        worker=stack.token('executor')
        def begin(id):
            try:request(stack.api,'/runs/'+id+'/begin',worker,{});return True
            except Rejected as e:
                assert e.status==403;return False
        with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool:admitted=list(pool.map(begin,jobs))
        accounting=stack.sql('SELECT spent,held,limit_units FROM account;','pilot').split('|')
        spent,held,limit=map(int,accounting)
        assert sum(admitted)==(limit-spent)//4 and held==sum(admitted)*4 and spent+held<=limit
        mark('concurrent_budget_admission_does_not_oversubscribe',attempts=32,admitted=sum(admitted),spent=spent,held=held,limit=limit)
        import sqlite3
        d=sqlite3.connect(stack.state/'external-provider.sqlite')
        sends=d.execute("SELECT count(*) FROM requests WHERE action='send'").fetchone()[0]
        receipts=d.execute('SELECT count(*) FROM receipts').fetchone()[0];d.close()
        assert sends==2 and receipts==2
        stack.evidence.update(result='PASS',external_sends=sends,external_receipts=receipts,elapsed_seconds=time.perf_counter()-started)
    except Exception as e:
        stack.evidence.update(result='FAIL',error=str(e),elapsed_seconds=time.perf_counter()-started);raise
    finally:stack.close()
