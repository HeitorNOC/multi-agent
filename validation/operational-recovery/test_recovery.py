import concurrent.futures as cf
import hashlib,json,time,uuid
from datetime import datetime,timezone
from pathlib import Path
import pytest
from harness import Installation,HERE
from protocol import Rejected
import bundle

def test_unknown_resolution_and_joint_cold_restore():
    s=Installation();started=time.perf_counter();records=[]
    def save(name,v):(HERE/'evidence'/name).write_text(json.dumps(v,ensure_ascii=False,indent=2,default=str),encoding='utf-8')
    def mark(name,**kw):s.evidence['scenarios'].append({'name':name,**kw});print('CHECKPOINT '+name,flush=True)
    def calls():
        p=s.state/'model-budget.json';return json.loads(p.read_text())['calls'] if p.exists() else 0
    def deny(fn,status):
        with pytest.raises(Rejected) as e:fn()
        assert e.value.status==status,str(e.value)
    def now():return datetime.now(timezone.utc).isoformat()
    def publish(source,domain,actor,version,content):
        raw=f'---\nsource: {source}\nversion: {version}\nvalid_at: 2026-01-01T00:00:00Z\ndomain: {domain}\n---\n{content}\n'
        path=Path(s.app_config['vault'])/(source+'.md');path.write_text(raw,encoding='utf-8')
        d=s.call(actor,'/drafts',{'path':path.name});s.call('aprovador','/review',{'id':d['id'],'raw_sha':d['raw_sha']})
        return s.call('aprovador','/publish',{'id':d['id']})
    def p(q,source='politica-remoto'):return {'request_id':str(uuid.uuid4()),'source':source,'question':q,'as_of':'2026-02-01T00:00:00Z','known_at':cut}
    def advice(actor,request):
        out=s.call(actor,'/advise',request);assert hashlib.sha256(out['record_json'].encode()).hexdigest()==out['sha256']
        records.append({'input':request,'envelope':out});save('decisions.json',records);return out
    try:
        save('protocol.json',{'fault':'before_receipt_after_native_generation','replacement':'two distinct governance identities; exact input binding; original owner',
            'restore':'coordinated cold dump, new PG/Neo volumes, restored editorial and vault, AES-GCM layer keys, retained revocation journal and budget',
            'negative_gates':['tampered bundle','missing canonical file','truncated retained journal','inconsistent restored inventory'],
            'model_cap':40,'provider':'gpt-6.1-terra','no_external_business_actions':True})
        s.start();publish('politica-remoto','publico','analista',1,'Manual sintético Aurora. A equipe Aurora pode trabalhar remotamente dois dias por semana. Despesas extraordinárias exigem dois revisores distintos. O projeto sintético de expansão se chama Horizonte.')
        publish('aquisicao','financeiro','financeiro',1,'A proposta sintética SIGILO_AQUISICAO_2026 tem valor de R$ 9.700.000. Nenhuma transação real foi autorizada.');cut=now()
        public_input=p('Quantos dias de trabalho remoto a equipe Aurora pode fazer por semana?');public=advice('analista',public_input)
        private_input=p('Qual o valor da proposta SIGILO_AQUISICAO_2026?','aquisicao');private=advice('financeiro',private_input)
        mark('real_native_public_and_private_advice_before_disaster')
        unknown=p('Quantos revisores distintos aprovam despesas extraordinárias da equipe Aurora?');before=calls()
        state=Path(s.app_config['state']);(state/'fault-arm.json').write_text(json.dumps({'stage':'before_receipt'}))
        with cf.ThreadPoolExecutor(1) as pool:
            f=pool.submit(s.call,'analista','/advise',unknown)
            for _ in range(900):
                reached=state/'fault-reached.json'
                if reached.exists() and json.loads(reached.read_text()).get('stage')=='before_receipt':break
                if f.done():f.result();raise AssertionError('fault not reached')
                time.sleep(.2)
            else:raise AssertionError('fault deadline')
            assert calls()>before
            s.stop_app()
            with pytest.raises(Exception) as err:f.result(timeout=20)
            save('disconnect.json',{'type':type(err.value).__name__,'message':str(err.value)})
        s.start_app();b=calls();deny(lambda:s.call('analista','/advise',unknown),503)
        inspected=s.call('aprovador','/pending/inspect',{'request_id':unknown['request_id']});assert not inspected['admission']['receipt_exists']
        close={'request_id':unknown['request_id'],'evidence_sha':inspected['evidence_sha'],'reason':'Processo interrompido após inferência; saída sem recibo, resultado desconhecido e possível consumo já ocorrido.'}
        deny(lambda:s.call('analista','/pending/close',close),403)
        deny(lambda:s.call('aprovador','/pending/close',{**close,'evidence_sha':'0'*64}),409)
        closed=s.call('aprovador','/pending/close',close);assert s.call('aprovador','/pending/close',close)==closed
        deny(lambda:s.call('analista','/advise',unknown),409)
        deny(lambda:s.call('analista','/advise',{**unknown,'request_id':str(uuid.uuid4())}),409)
        new_id=str(uuid.uuid4());approve={'request_id':unknown['request_id'],'new_id':new_id}
        deny(lambda:s.call('aprovador','/pending/authorize',approve),403)
        replacement=s.call('auditor','/pending/authorize',approve)
        assert s.call('auditor','/pending/authorize',approve)==replacement and calls()==b
        deny(lambda:s.call('financeiro','/advise',replacement['input']),403)
        deny(lambda:s.call('analista','/advise',{**replacement['input'],'question':'entrada alterada depois de aprovada'}),409)
        new=advice('analista',replacement['input']);assert json.loads(new['record_json'])['retry_of']==unknown['request_id']
        assert s.sql("SELECT count(*) FROM decisions WHERE id='"+unknown['request_id']+"'",'pilot')=='0'
        save('closure-and-replacement.json',{'inspected':inspected,'closure':closed,'authorization':replacement,'new':new})
        mark('unknown_closed_without_reexecution_and_separately_authorized_replacement')
        root=bundle.backup(s);budget=calls()
        # Negative bundle tests happen before any destructive restore action.
        canonical=root/'editorial.sqlite';original=canonical.read_bytes();canonical.write_bytes(original+b'TAMPER')
        with pytest.raises(ValueError,match='hash mismatch'):bundle.restore(s)
        canonical.write_bytes(original)
        original_manifest=(root/'manifest.json').read_bytes();(root/'manifest.json').write_bytes(original_manifest.replace(b'joint-g1',b'joint-gX'))
        with pytest.raises(ValueError,match='signature'):bundle.restore(s)
        (root/'manifest.json').write_bytes(original_manifest)
        assert s.sql('SELECT 1','pilot')=='1' and s.call('analista','/decisions/'+public['id'],None,method='GET')==public
        mark('corrupt_bundle_rejected_before_live_containers_touched')
        finance=next(a['id'] for a in s.principals if a['name']=='financeiro')
        s.call('aprovador','/admin/revoke',{'principal':finance,'source':'aquisicao'});deny(lambda:s.call('financeiro','/decisions/'+private['id'],None,method='GET'),403)
        # Restore actual layer keys from encrypted bundle, not these now deliberately wrong values.
        s.editorial_key='00'*32;s.journal_key='11'*32
        bundle.restore(s);assert calls()==budget
        deny(lambda:s.call('analista','/decisions/'+public['id'],None,method='GET'),503)
        deny(lambda:s.call('analista','/recovery/open',{}),403)
        s.stop_app();s.start_app();assert s.call('aprovador','/recovery/status',{})['recovering']
        mark('cold_restore_new_volumes_and_canonical_keys_stays_fenced_across_restart')
        journal=s.state/'security-journal.jsonl';raw=journal.read_bytes();journal.write_bytes(b'')
        deny(lambda:s.call('aprovador','/recovery/open',{}),409);journal.write_bytes(raw)
        # Tamper one restored business row: full inventory must prevent opening.
        s.sql("UPDATE sources SET domain='financeiro' WHERE id='politica-remoto'",'pilot')
        deny(lambda:s.call('aprovador','/recovery/open',{}),409)
        s.sql("UPDATE sources SET domain='publico' WHERE id='politica-remoto'",'pilot')
        opened=s.call('aprovador','/recovery/open',{});assert opened['opened'] and opened['journal_events']==1
        save('recovery-open.json',opened)
        assert s.call('analista','/decisions/'+public['id'],None,method='GET')==public
        assert s.call('analista','/advise',public_input)==public
        assert s.call('analista','/advise',replacement['input'])==new
        deny(lambda:s.call('analista','/advise',unknown),409)
        deny(lambda:s.call('financeiro','/decisions/'+private['id'],None,method='GET'),403)
        assert s.call('aprovador','/decisions/'+private['id'],None,method='GET')==private and calls()==budget
        mark('joint_inventory_matches_old_records_exact_and_postbackup_revocation_survives')
        fresh=advice('analista',p('Qual é o nome do projeto de expansão da equipe Aurora?'))
        native=json.loads(fresh['record_json']);answer=native['response']['llm_response']['content']
        assert 'Horizonte' in answer and 'politica-remoto@v1.md' in answer
        mark('restored_native_index_answers_new_question',new_model_calls=calls()-budget)
        # A new review/publication validates restored editorial key and vault path, not just old record reads.
        publish('politica-remoto','publico','analista',2,'Nova versão sintética: a equipe Aurora passa a ter três dias remotos por semana. O projeto permanece Horizonte.')
        assert s.call('analista','/decisions/'+public['id'],None,method='GET')==public
        mark('restored_editorial_can_review_and_publish_new_version_without_mutating_old_advice')
        s.evidence.update(result='PASS',execution_completed=True,model_calls=calls(),elapsed_seconds=time.perf_counter()-started)
    except Exception as e:s.evidence.update(result='FAIL',error=str(e),elapsed_seconds=time.perf_counter()-started);raise
    finally:s.close()
