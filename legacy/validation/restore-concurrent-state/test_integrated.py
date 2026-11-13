import concurrent.futures as cf
import hashlib,json,sqlite3,time,uuid
from datetime import datetime,timezone
from pathlib import Path
import pytest
from harness import Installation,HERE
from protocol import request,Rejected
from authority_client import request as authority
from controls import dump,sign
import bundle

def test_two_api_coordinated_restore_preserves_current_state_and_quotas():
    s=Installation();started=time.perf_counter();records=[];abandoned=[]
    def save(name,v):(HERE/'evidence'/name).write_text(json.dumps(v,ensure_ascii=False,indent=2,default=str),encoding='utf-8')
    def mark(name,**kw):s.evidence['scenarios'].append({'name':name,**kw});print('CHECKPOINT '+name,flush=True)
    def cfg():return {k:s.app_config[k] for k in ('freshness_url','freshness_secret','freshness_public','installation')}
    def proof():return authority(cfg(),action='proof')
    def calls():return proof()['budgets']['model']['reserved']
    def call(api,actor,path,p=None,method=None):return request(api,path,s.token(actor),p,method)
    def deny(fn,status):
        with pytest.raises(Rejected) as e:fn()
        assert e.value.status==status,str(e.value)
    def now():return datetime.now(timezone.utc).isoformat()
    def p(q):return {'request_id':str(uuid.uuid4()),'source':'politica-remoto','question':q,'as_of':'2026-02-01T00:00:00Z','known_at':cut}
    def record(inp,out):
        assert hashlib.sha256(out['record_json'].encode()).hexdigest()==out['sha256']
        records.append({'input':inp,'envelope':out});save('decisions.json',records)
    def fault(inp,stage):
        state=Path(s.app_config['state']);(state/'fault-arm.json').write_text(dump({'stage':stage,'instance':s.app_config['instance']}));(state/'fault-reached.json').write_text('{}')
        with cf.ThreadPoolExecutor(1) as pool:
            f=pool.submit(s.call,'analista','/advise',inp)
            for _ in range(900):
                if json.loads((state/'fault-reached.json').read_text()).get('stage')==stage:break
                if f.done():f.result();raise AssertionError('fault not reached')
                time.sleep(.2)
            else:raise AssertionError('fault deadline')
            s.stop_app()
            with pytest.raises(Exception) as err:f.result(timeout=20)
            save('disconnect-'+stage+'.json',{'type':type(err.value).__name__,'message':str(err.value)})
        deny(lambda:call(s.peer_api,'analista','/advise',inp),503)
        status=call(s.peer_api,'controlador','/freshness/status',{})
        assert len(status['pending'])==1;return status['pending'][0]['seq']
    def restart_authority():
        s.freshness_service,s.freshness_url=s.process('freshness_authority',{'path':str(s.state/'retained-authority.sqlite'),'installation':s.id,
            'private_key':s.freshness_private,'secret':s.freshness_secret,'caps':{'model':40,'stress':7},'evidence':str(HERE/'evidence/freshness-requests.jsonl')})
        s.start_apps()
    def sqlquote(value):return "'"+str(value).replace("'","''")+"'"
    try:
        save('protocol.json',{'provider':'gpt-6.1-terra','cap':40,'replicas':2,'backup':'drain accepted work, freeze all writers, cold snapshot all app processes',
            'cases':['g1_stale_denied','g2_complete_restore','new_tables_tamper_denied','retained_counter_reset_denied','abandoned_reservation_not_refunded','eight_requests_after_restore'],
            'private_faults':['pause_before_receipt','after_fresh_intent','after_receipt'],'no_external_actions':True})
        s.start();s.start_peer()
        raw='---\nsource: politica-remoto\nversion: 1\nvalid_at: 2026-01-01T00:00:00Z\ndomain: publico\n---\nA equipe Aurora tem dois dias remotos por semana. O projeto se chama Horizonte. O teto diário de alimentação é R$ 240. Despesas extraordinárias exigem dois revisores distintos.\n'
        path=Path(s.app_config['vault'])/'manual.md';path.write_text(raw,encoding='utf-8')
        d=s.call('analista','/drafts',{'path':path.name});s.call('controlador','/review',{'id':d['id'],'raw_sha':d['raw_sha']});s.call('controlador','/publish',{'id':d['id']});cut=now()
        warm=p('Como se chama o projeto da equipe Aurora?');original=s.call('analista','/advise',warm);record(warm,original)
        finance_input={**warm,'request_id':str(uuid.uuid4())};finance=call(s.peer_api,'financeiro','/advise',finance_input);record(finance_input,finance)
        for _ in range(4):authority(cfg(),action='reserve_call',scope='stress',id=str(uuid.uuid4()))
        # Freeze must wait for an already-admitted request, then block both replicas and revocations.
        flight=p('Qual o teto diário de alimentação da equipe Aurora?');state=Path(s.app_config['state'])
        (state/'fault-arm.json').write_text(dump({'stage':'before_receipt','instance':s.app_config['instance'],'mode':'pause'}));(state/'fault-reached.json').write_text('{}');(state/'pause-release.json').write_text('{}')
        cached_tokens={name:s.token(name) for name in ('analista','controlador')};old_apis=[s.api,s.peer_api];s.hold_backup=True
        with cf.ThreadPoolExecutor(2) as pool:
            f=pool.submit(s.call,'analista','/advise',flight)
            for _ in range(900):
                if json.loads((state/'fault-reached.json').read_text()).get('stage')=='before_receipt':break
                if f.done():f.result();raise AssertionError('pause not reached')
                time.sleep(.2)
            else:raise AssertionError('pause deadline')
            b=pool.submit(bundle.backup,s,'g1');time.sleep(.4);assert not b.done()
            (state/'pause-release.json').write_text('{"release":true}')
            frozen_path=s.state/'backup-frozen-g1.json'
            for _ in range(300):
                if frozen_path.exists():break
                if b.done():b.result();raise AssertionError('freeze marker not reached')
                time.sleep(.1)
            else:raise AssertionError('freeze deadline')
            frozen=json.loads(frozen_path.read_text());before=calls();head=proof()['head'];blocked=p('Qualquer novo pedido durante o congelamento?')
            for api in old_apis:
                deny(lambda:request(api,'/advise',cached_tokens['analista'],blocked),503)
                deny(lambda:request(api,'/admin/revoke',cached_tokens['controlador'],{'principal':'unused','source':'politica-remoto'}),503)
            assert calls()==before and proof()['head']==head
            (s.state/'backup-release-g1.json').write_text('{"release":true}')
            flight_out=f.result(timeout=180);g1=b.result(timeout=180);record(flight,flight_out)
        s.hold_backup=False
        assert s.call('analista','/advise',flight)==flight_out
        save('freeze-snapshot.json',frozen);mark('freeze_drains_accepted_work_and_blocks_both_api_writers_and_revocation')
        # Unknown intent after g1: close by two identities, retain proposal and tombstone.
        unknown=p('Qual o procedimento excepcional de trabalho remoto da equipe Aurora?');seq=fault(unknown,'after_fresh_intent')
        inspected=call(s.peer_api,'auditor','/freshness/inspect',{'seq':seq})
        proposal={'seq':seq,'reason':'Intenção sem recibo durável após interrupção; encerrar como desconhecido, sem sucesso ou reexecução.','evidence_sha':inspected['evidence_sha']}
        call(s.peer_api,'auditor','/freshness/close-prepare',proposal)
        closed=call(s.peer_api,'controlador','/freshness/close-confirm',{'seq':seq,'evidence_sha':inspected['evidence_sha']});save('closed-unknown.json',closed)
        s.start_app()
        # A different interrupted decision is reconciled, leaving immutable audit rows after g1.
        recovered_input=p('Quantos revisores distintos aprovam despesas extraordinárias?');seq2=fault(recovered_input,'after_receipt')
        assert call(s.peer_api,'controlador','/freshness/reconcile',{'seq':seq2})['matches']
        recovered=call(s.peer_api,'analista','/advise',recovered_input);record(recovered_input,recovered);s.start_app()
        for _ in range(3):authority(cfg(),action='reserve_call',scope='stress',id=str(uuid.uuid4()))
        g2=bundle.backup(s,'g2');keys,manifest=bundle.verify(s);assert manifest['budget_floors']['stress']['reserved']==7
        # A trusted legacy-format manifest still needs an explicit migration; no implicit upgrade.
        raw_manifest=(g2/'manifest.json').read_bytes();legacy=json.loads(raw_manifest);legacy['payload']['format']='old-incompatible-format';legacy['signature']=sign(s.journal_key,legacy['payload'])
        (g2/'manifest.json').write_text(dump(legacy),encoding='utf-8')
        with pytest.raises(ValueError,match='unsupported bundle format'):bundle.restore(s)
        (g2/'manifest.json').write_bytes(raw_manifest)
        assert s.call('analista','/advise',warm)==original
        mark('latest_bundle_covers_proposal_tombstone_reconciliation_and_rejects_implicit_legacy_upgrade')
        # Consume one model-scope seat without starting Codex: failed client reservations must not be refunded by restore.
        seat=authority(cfg(),action='reserve_call',scope='model',id=str(uuid.uuid4()))['reservation'];abandoned.append(seat);save('abandoned-reservations.json',abandoned)
        finance_id=next(x['id'] for x in s.principals if x['name']=='financeiro')
        s.call('controlador','/admin/revoke',{'principal':finance_id,'source':'politica-remoto'});budget=calls()
        s.backup_path=g1;bundle.restore(s)
        stale=s.call('controlador','/freshness/status',{});save('stale-g1.json',stale);assert not stale['matches']
        for api in [s.api,s.peer_api]:
            deny(lambda:call(api,'controlador','/recovery/open',{}),409)
            deny(lambda:call(api,'analista','/advise',unknown),503)
            deny(lambda:call(api,'controlador','/recovery/thaw',{'token':frozen['token']}),409)
        assert calls()==budget
        mark('old_bundle_cannot_resurrect_unknown_intent_or_override_joint_restore_with_thaw')
        s.backup_path=g2;bundle.restore(s);assert s.call('controlador','/freshness/status',{})['matches']
        # Each newly covered table must participate in the inventory gate.
        for table,key,column,old in [
            ('intent_tombstones',str(seq),'confirmed_by',closed['outcome']['confirmed_by']),
            ('intent_proposals',str(seq),'reason',proposal['reason']),
        ]:
            s.sql(f'UPDATE {table} SET {column}=\'tampered\' WHERE seq={key}','pilot')
            deny(lambda:s.call('controlador','/recovery/open',{}),409)
            s.sql(f'UPDATE {table} SET {column}={sqlquote(old)} WHERE seq={key}','pilot')
        audit=json.loads(s.sql("SELECT row_to_json(t) FROM (SELECT id,action FROM reconciliation_audit ORDER BY recorded_at LIMIT 1)t",'pilot'))
        s.sql('UPDATE reconciliation_audit SET action=\'tampered\' WHERE id='+sqlquote(audit['id']),'pilot')
        deny(lambda:s.call('controlador','/recovery/open',{}),409)
        s.sql('UPDATE reconciliation_audit SET action='+sqlquote(audit['action'])+' WHERE id='+sqlquote(audit['id']),'pilot')
        mark('tampering_tombstone_proposal_or_reconciliation_audit_prevents_opening')
        # Deliberately reset only authority counters, keeping operations intact, to exercise quota floors.
        s.stop_apps();s.freshness_service.terminate();s.freshness_service.wait(timeout=10)
        retained=s.state/'retained-authority.sqlite';safe=s.state/'authority-before-counter-rollback.sqlite'
        with sqlite3.connect(retained) as src,sqlite3.connect(safe) as dst:src.backup(dst)
        with sqlite3.connect(retained) as db:db.execute('DELETE FROM reservations')
        restart_authority();assert s.call('controlador','/freshness/status',{})['matches'] and proof()['budgets']['model']['reserved']==0
        for api in [s.api,s.peer_api]:deny(lambda:call(api,'controlador','/recovery/open',{}),409)
        s.stop_apps();s.freshness_service.terminate();s.freshness_service.wait(timeout=10)
        with sqlite3.connect(safe) as src,sqlite3.connect(retained) as dst:src.backup(dst)
        restart_authority();assert calls()==budget
        mark('counter_rollback_is_denied_even_when_operation_head_matches')
        opened=s.call('controlador','/recovery/open',{});save('latest-open.json',opened);assert opened['opened'] and opened['retained_budgets']['model']['reserved']==budget
        for api in [s.api,s.peer_api]:
            assert call(api,'analista','/advise',warm)==original
            assert call(api,'analista','/advise',recovered_input)==recovered
            deny(lambda:call(api,'analista','/advise',unknown),409)
            deny(lambda:call(api,'financeiro','/decisions/'+finance['id'],None,method='GET'),403)
        assert s.call('controlador','/decisions/'+finance['id'],None,method='GET')==finance and calls()==budget
        for n in range(3):
            with pytest.raises(Exception) as e:authority(cfg(),action='reserve_call',scope='stress',id=str(uuid.uuid4()))
            assert getattr(e.value,'code',None)==409
        mark('both_restored_apis_preserve_exact_records_closed_id_postbackup_revocation_and_full_quota')
        fresh={**p('Como se chama o projeto e quantos dias remotos por semana a equipe Aurora tem?'),'as_of':'2026-03-15T00:00:00Z'}
        with cf.ThreadPoolExecutor(8) as pool:outs=list(pool.map(lambda n:call(s.api if n%2==0 else s.peer_api,'analista','/advise',fresh),range(8)))
        assert all(o==outs[0] for o in outs)
        r=json.loads(outs[0]['record_json']);answer=r['response']['llm_response']['content'];assert 'Horizonte' in answer and ('dois' in answer.lower() or '2' in answer)
        assert s.sql("SELECT count(*) FROM decisions WHERE id='"+fresh['request_id']+"'",'pilot')=='1' and calls()>budget
        record(fresh,outs[0]);save('final-proof.json',proof());mark('eight_requests_on_restored_native_index_make_one_new_record_without_call_id_reuse')
        s.evidence.update(result='PASS',execution_completed=True,model_reserved=calls(),abandoned_reservations=abandoned,elapsed_seconds=time.perf_counter()-started)
    except Exception as e:s.evidence.update(result='FAIL',error=str(e),elapsed_seconds=time.perf_counter()-started);raise
    finally:s.close()
