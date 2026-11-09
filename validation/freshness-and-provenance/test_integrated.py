import concurrent.futures as cf
import hashlib,json,re,time,uuid
from pathlib import Path
from datetime import datetime,timezone
import pytest
from harness import Installation,HERE
from protocol import Rejected
import bundle
from grader import denies_validity_start

def test_temporal_metadata_and_retained_highwater():
    s=Installation();started=time.perf_counter();answers=[];records=[]
    def save(name,v):(HERE/'evidence'/name).write_text(json.dumps(v,ensure_ascii=False,indent=2,default=str),encoding='utf-8')
    def mark(name,**kw):s.evidence['scenarios'].append({'name':name,**kw});print('CHECKPOINT '+name,flush=True)
    def now():return datetime.now(timezone.utc).isoformat()
    def calls():
        path=s.state/'model-budget.json';return json.loads(path.read_text())['calls'] if path.exists() else 0
    def deny(fn,status):
        with pytest.raises(Rejected) as e:fn()
        assert e.value.status==status,str(e.value)
    def publish(v,valid,body):
        raw=f'---\nsource: politica-remoto\nversion: {v}\nvalid_at: {valid}\ndomain: publico\n---\n{body}\n'
        path=Path(s.app_config['vault'])/'manual.md';path.write_text(raw,encoding='utf-8')
        d=s.call('analista','/drafts',{'path':path.name});s.call('aprovador','/review',{'id':d['id'],'raw_sha':d['raw_sha']});return s.call('aprovador','/publish',{'id':d['id']})
    def payload(asof,known,question='Como se chama o projeto de expansão da equipe Aurora e desde quando a versão selecionada está vigente? Cite a fonte.'):
        return {'request_id':str(uuid.uuid4()),'source':'politica-remoto','question':question,'as_of':asof,'known_at':known}
    def advice(name,p,version,project,month):
        out=s.call('analista','/advise',p);r=json.loads(out['record_json']);text=r['response']['llm_response']['content'];basis=r['canonical_basis']
        date_pattern={1:r'1[ºo°]?\s*(?:de\s*)?janeiro|0?1[/.-]0?1[/.-]2026|2026-01-01',3:r'1[ºo°]?\s*(?:de\s*)?março|0?1[/.-]0?3[/.-]2026|2026-03-01'}[month]
        checks={'project':project.lower() in text.lower(),'valid_from':bool(re.search(date_pattern,text,re.I)),
            'no_missing_date_claim':not denies_validity_start(text),
            'source_version':r['canonical_snapshot']['version']==version and basis['version']==version,
            'basis_dates':basis['valid_from']==f'2026-0{month}-01T00:00:00Z' and basis['published_at']==r['canonical_snapshot']['known_at'],
            'citation':bool(re.search(r'\[\d+\]',text)) and f'politica-remoto@v{version}.md' in text,
            'hash':hashlib.sha256(out['record_json'].encode()).hexdigest()==out['sha256']}
        answers.append({'case':name,'checks':checks,'answer':text,'canonical_basis':basis});records.append({'input':p,'envelope':out})
        save('acceptance.json',answers);save('decisions.json',records)
        return out
    try:
        save('protocol.json',{'provider':'gpt-6.1-terra','cap':40,'temporal_cases':['v1_validity_only_metadata','v2_validity_only_metadata','historical_knowledge_cutoff','new_after_latest_restore'],
            'oracle':'project, selected version, valid_from date and citation; no claim that canonical validity is missing',
            'restore_cases':['old_g1_rejected_with_missing_approval_publication_decision','latest_g2_opens_after_joint_inventory_and_live_nonce_proof','pending_intent_fences_after_crash'],
            'scope':'synthetic, one process; authority same host but separate store outside backup; no external business actions'})
        s.start();before_any=now()
        publish(1,'2026-01-01T00:00:00Z','A equipe Aurora tem dois dias de trabalho remoto por semana. O projeto de expansão se chama Horizonte.');known_v1=now()
        first_input=payload('2026-02-01T00:00:00Z',known_v1);first=advice('v1_validity_only_metadata',first_input,1,'Horizonte',1)
        before=calls();denied={**first_input,'request_id':str(uuid.uuid4()),'valid_from':'1900-01-01'};seq=s.call('aprovador','/freshness/status',{})['seq']
        deny(lambda:s.call('analista','/advise',denied),409);assert calls()==before and s.call('aprovador','/freshness/status',{})['seq']==seq
        absent=s.call('analista','/advise',payload('2026-02-01T00:00:00Z',before_any));assert json.loads(absent['record_json'])['response']['abstained'] and calls()==before
        g1=bundle.backup(s,'g1');g1_status=s.call('aprovador','/freshness/status',{});assert g1_status['matches']
        mark('metadata_only_validity_and_caller_cannot_override_backend')
        publish(2,'2026-03-01T00:00:00Z','A equipe Aurora tem três dias de trabalho remoto por semana. O projeto de expansão se chama Solstício.');known_v2=now()
        second_input=payload('2026-03-15T00:00:00Z',known_v2);second=advice('v2_validity_only_metadata',second_input,2,'Solstício',3)
        historical=advice('historical_knowledge_cutoff',payload('2026-03-15T00:00:00Z',known_v1),1,'Horizonte',1)
        # Check unsupported attribute separately from metadata: date availability must not create a headcount.
        unknown=s.call('analista','/advise',payload('2026-03-15T00:00:00Z',known_v2,'Quantas pessoas integram a equipe Aurora? Se a fonte não disser, declare que não há informação.'))
        unknown_text=json.loads(unknown['record_json'])['response']['llm_response']['content'];save('unknown-attribute.json',{'answer':unknown_text,'record':unknown})
        assert re.search(r'não (?:há|informa|consta|é informad)|sem informa|não.*informa',unknown_text,re.I)
        g2=bundle.backup(s,'g2');current=s.call('aprovador','/freshness/status',{});assert current['matches'] and current['seq']>g1_status['seq'];budget=calls()
        mark('source_approval_publication_and_decisions_advance_retained_authority')
        s.backup_path=g1;bundle.restore(s)
        stale=s.call('aprovador','/freshness/status',{});save('stale-g1.json',stale)
        assert not stale['matches'] and {'approval','publication','decision'}<={r['kind'] for r in stale['missing']}
        deny(lambda:s.call('aprovador','/recovery/open',{}),409)
        deny(lambda:s.call('analista','/decisions/'+first['id'],None,method='GET'),503)
        s.stop_app();s.start_app();deny(lambda:s.call('aprovador','/recovery/open',{}),409)
        assert calls()==budget
        mark('coherent_old_backup_denied_for_missing_postbackup_operations',missing=len(stale['missing']))
        s.backup_path=g2;bundle.restore(s)
        assert s.call('aprovador','/freshness/status',{})['matches']
        assert s.call('aprovador','/recovery/status',{})['recovering']
        opened=s.call('aprovador','/recovery/open',{});save('latest-g2-open.json',opened);assert opened['opened']
        assert s.call('analista','/advise',first_input)==first and s.call('analista','/advise',second_input)==second and calls()==budget
        mark('latest_complete_bundle_opens_and_exact_old_advice_needs_no_model')
        fresh_input=payload('2026-04-01T00:00:00Z',known_v2)
        advice('new_after_latest_restore',fresh_input,2,'Solstício',3)
        # A remote intent without local mutation/receipt also prevents stale availability claims.
        pending=payload('2026-04-01T00:00:00Z',known_v2,'Qual política de trabalho remoto a equipe Aurora aplica?')
        state=Path(s.app_config['state']);(state/'fault-arm.json').write_text(json.dumps({'stage':'after_fresh_intent'}));(state/'fault-reached.json').write_text('{}');b=calls()
        with cf.ThreadPoolExecutor(1) as pool:
            f=pool.submit(s.call,'analista','/advise',pending)
            for _ in range(300):
                if json.loads((state/'fault-reached.json').read_text()).get('stage')=='after_fresh_intent':break
                if f.done():f.result();raise AssertionError('fault not reached')
                time.sleep(.2)
            else:raise AssertionError('fault deadline')
            s.stop_app()
            with pytest.raises(Exception) as e:f.result(timeout=20)
            save('intent-disconnect.json',{'type':type(e.value).__name__,'message':str(e.value)})
        s.start_app();pending_state=s.call('aprovador','/freshness/status',{});save('pending-intent.json',pending_state)
        assert len(pending_state['pending'])==1 and not pending_state['matches'] and calls()==b
        deny(lambda:s.call('aprovador','/recovery/open',{}),409);deny(lambda:s.call('analista','/advise',pending),503)
        assert s.sql("SELECT count(*) FROM decision_admissions WHERE id='"+pending['request_id']+"'",'pilot')=='0'
        mark('unconfirmed_authority_intent_stays_fenced_after_restart_without_inference')
        passed=sum(all(a['checks'].values()) for a in answers)
        s.evidence.update(result='PASS' if passed==len(answers) else 'FAIL_SEMANTIC',execution_completed=True,
            temporal_passed=passed,temporal_total=len(answers),model_calls=calls(),elapsed_seconds=time.perf_counter()-started)
        assert passed==len(answers),f'temporal answers {passed}/{len(answers)}; original negatives preserved'
    except Exception as e:
        if not s.evidence.get('execution_completed'):s.evidence.update(result='FAIL',error=str(e),elapsed_seconds=time.perf_counter()-started)
        raise
    finally:s.close()
