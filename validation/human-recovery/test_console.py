"""Browser-equivalent HTTP contract with actual MVP server, protocol and independent sessions."""
import concurrent.futures,json,pathlib,sqlite3,uuid,urllib.request
from lab import App

def binding(inspection):return {'request_id':str(uuid.uuid4()),'case_id':inspection['case_id'],'operation_id':inspection['operation_id'],'evidence_sha':inspection['evidence_sha']}

def test_central_two_reviewers_restart_lost_ack_and_multiple_cases():
    app=App()
    try:
        app.start();app.setup_cases();anonymous=app.client()
        assert anonymous.call('cases')[0]==401
        assert anonymous.call('session',{'credential':'invalid','actor':'board'})[0]==400
        assert anonymous.call('session',{'credential':'invalid'})[0]==401
        first,second=app.client(0),app.client(1)
        assert first.call('session')[1]['actor']=='board' and second.call('session')[1]['actor']=='reviewer2'
        assert first.call('inspect',{'case_id':app.known['case_id'],'actor':'reviewer2'})[0]==400
        assert first.call('inspect',{'case_id':app.known['case_id']},{'Origin':'https://untrusted.example'})[0]==409
        req=urllib.request.Request(app.backend+'/rpc',json.dumps({'action':'recovery_bridge','reviewer':'board','command':{'action':'recovery_queue'}}).encode(),{'content-type':'application/json','x-demo-token':app.token})
        try:urllib.request.urlopen(req,timeout=5);raise AssertionError('worker token authorized recovery')
        except urllib.error.HTTPError as error:assert error.code==403
        status,queue=first.call('cases');assert status==200 and len(queue['cases'])==2
        assert any(c['case_id']==app.unknown['case_id'] and not c['actionable'] for c in queue['cases'])
        status,inspection=first.call('inspect',{'case_id':app.known['case_id']});assert status==200 and inspection['mode']=='read_receipt'
        assert inspection['evidence_summary']['provider_state']=='complete' and inspection['evidence_summary']['verified_receipt_sha']
        assert inspection['evidence_summary']['sources'][0]['content_sha'] and 'semantic' not in json.dumps(inspection)
        proposal={**binding(inspection),'reason':'Verificar recibo e inventário atual sem regenerar inferência ou devolver reserva.'}
        assert first.call('propose',{**proposal,'evidence_sha':'0'*64})[0]==409
        assert first.call('propose',proposal)[0]==409
        proposal['request_id']=str(uuid.uuid4())
        assert first.call('propose',proposal)[0]==200
        own_confirm=binding(inspection);assert first.call('confirm',own_confirm)[0]==403
        assert first.call('confirm',{**binding(inspection)},{'x-reviewer':'reviewer2'})[0]==403
        confirm=binding(inspection)
        app.restart_node()
        assert first.call('session')[1]['actor']=='board'
        second_inspection=second.call('inspect',{'case_id':app.known['case_id']})[1]
        assert second_inspection['votes'][0]['actor']=='board' and second_inspection['votes'][0]['reason']==proposal['reason']
        before=app.confirm_calls
        with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:responses=list(pool.map(lambda _:second.call('confirm',confirm),range(2)))
        status,recovered=responses[0];assert all(item[0]==200 for item in responses) and app.confirm_calls==before+1
        assert status==200 and recovered['result']['kind']=='reconciled_read'
        assert 'receipt' not in recovered['result'] and 'semantic' not in json.dumps(recovered)
        assert second.call('confirm',confirm)[0]==200
        assert second.call('confirm',{**confirm,'evidence_sha':'f'*64})[0]==409
        assert first.call('retry',{'request_id':confirm['request_id']})[0]==404
        queue=first.call('cases')[1];assert len(queue['cases'])==1 and queue['cases'][0]['case_id']==app.unknown['case_id'] and queue['cases'][0]['actionable']
        status,unknown=first.call('inspect',{'case_id':app.unknown['case_id']});assert status==200 and unknown['mode']=='inference_unknown'
        assert unknown['evidence_summary']['verified_receipt_sha'] is None
        proposal2={**binding(unknown),'reason':'Resultado não recuperável: encerrar desconhecido, manter reserva e impedir repetição.'}
        assert first.call('propose',proposal2)[0]==200
        app.drop_confirm_response=True;confirmation2=binding(unknown)
        assert second.call('confirm',confirmation2)[0]==503
        commands=second.call('commands')[1]['commands'];assert any(c['id']==confirmation2['request_id'] and c['status']=='unknown' for c in commands)
        app.restart_node()
        status,closed=second.call('retry',{'request_id':confirmation2['request_id']});assert status==200 and closed['result']['kind']=='closed_inference_unknown'
        assert closed['result']['reservation']=='retained_not_refunded' and 'semantic' not in json.dumps(closed)
        queue=second.call('cases')[1];assert queue['cases']==[] and len(queue['history'])==2 and queue['authority_current']
        assert all(set(item['reviewers'])=={'board','reviewer2'} for item in queue['history'])
        assert app.lab.call('owner','status',job=app.unknown['job'])['state']=='closed_unknown'
        stats=app.lab.control('stats')['rows'];assert len(stats)==2 and all(r[2]==1 for r in stats)
        with sqlite3.connect(app.config['state']+'/journey.sqlite') as db:
            assert db.execute("SELECT count(*) FROM recovery_commands WHERE status='unknown'").fetchone()[0]==0
            assert db.execute("SELECT count(*) FROM events WHERE node='recovery_delivery_unknown'").fetchone()[0]>=1
        assert second.call('logout',{})[0]==200 and second.call('cases')[0]==401
        app.lab.evidence.update(result='PASS_HUMAN_RECOVERY_INTEGRATION',cases=2,independent_sessions=2,api_restarts=2,lost_ack_reconciled=True,model_calls=0,provider_executions=stats,history=queue['history'])
    except BaseException as error:app.lab.evidence.update(result='FAIL_HUMAN_RECOVERY_INTEGRATION',error=app.lab.redact(repr(error)));raise
    finally:app.close()

def test_multiple_unknown_selection_stale_evidence_and_current_grants_on_replay():
    app=App()
    try:
        app.start();one,two=app.unknown_case(),app.unknown_case();first,second=app.client(0),app.client(1)
        queue=first.call('cases')[1];assert len(queue['cases'])==2 and all(c['actionable'] for c in queue['cases'])
        old_second=first.call('inspect',{'case_id':two['case_id']})[1]
        current=first.call('inspect',{'case_id':one['case_id']})[1]
        assert first.call('propose',{**binding(current),'reason':'Revisar somente o caso selecionado, sem reutilizar inferência ou devolver reserva.'})[0]==200
        assert second.call('confirm',{**binding(current),'case_id':two['case_id']})[0]==409
        confirmation=binding(current);assert second.call('confirm',confirmation)[0]==200
        assert first.call('propose',{**binding(old_second),'reason':'Esta evidência antiga deve ser recusada antes de admitir outra revisão.'})[0]==409
        fresh=first.call('inspect',{'case_id':two['case_id']})[1];assert fresh['evidence_sha']!=old_second['evidence_sha']
        assert first.call('propose',{**binding(fresh),'reason':'Revisar evidência atualizada do segundo caso e manter sua reserva integral.'})[0]==200
        assert second.call('confirm',binding(fresh))[0]==200
        older=app.lab.backup('before-revocation');app.lab.start_business()
        app.lab.call('board','revoke',principal='reviewer2',source='politica-remoto')
        assert second.call('confirm',confirmation)[0]==403
        assert second.call('commands')[1]['commands']==[]
        with sqlite3.connect(app.config['state']+'/journey.sqlite') as db:
            assert db.execute('SELECT status FROM recovery_commands WHERE id=?',(confirmation['request_id'],)).fetchone()[0]=='completed'
        queue=first.call('cases')[1];assert queue['cases']==[] and queue['budgets']['business']['reserved']==2
        stats=app.lab.control('stats')['rows'];assert len(stats)==2 and all(row[1]=='closed_unknown' and row[2]==1 for row in stats)
        app.lab.activate(older)
        fenced=first.call('cases')[1];assert fenced['blocked'] and not fenced['authority_current'] and fenced['cases']==[] and fenced['history']==[]
        app.lab.evidence.update(result='PASS_SELECTED_UNKNOWN_AND_REVOCATION',cases=2,stale_evidence_rejected=True,revoked_replay_rejected=True,model_calls=0,provider_executions=stats)
    except BaseException as error:app.lab.evidence.update(result='FAIL_SELECTED_UNKNOWN_AND_REVOCATION',error=app.lab.redact(repr(error)));raise
    finally:app.close()
