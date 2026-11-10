"""Predeclared synthetic oracles; native retrieval, one API process, real providers."""
import concurrent.futures as cf
import hashlib,json,os,re,time,uuid
from datetime import datetime,timezone
from pathlib import Path
import pytest
from harness import Installation,HERE
from protocol import Rejected
from codex_provider import CodexProvider

CASES=[
 ('meal','Qual é o teto diário de reembolso de alimentação da equipe Aurora, sem confundir com transporte?',r'240|duzentos e quarenta'),
 ('deadline','Qual o horário limite para enviar o comprovante de despesa da equipe Aurora?',r'18[:h]30|dezoito.*trinta'),
 ('review','Quantos revisores distintos precisam aprovar despesas extraordinárias da equipe Aurora?',r'dois|\b2\b'),
 ('unknown','Qual é o limite de diárias de hotel da equipe Aurora?',r'não (?:há|consta|existe|foi|está|é)|sem informa|ausência|não.*informad'),
]
CORPUS='''Manual sintético de despesas da equipe Aurora, vigente desde 1 de janeiro de 2026.
Alimentação: o teto diário de reembolso da equipe Aurora é R$ 240 por pessoa. Valores acima do teto não são reembolsáveis.
Transporte: o teto diário é R$ 85 por pessoa. Esse valor não é o teto de alimentação.
Prazo: os comprovantes de despesa da equipe Aurora devem ser enviados até 18:30 no dia útil seguinte. O prazo de 17:00 pertence apenas à equipe Boreal.
Aprovação: despesas extraordinárias da equipe Aurora exigem dois revisores distintos. O solicitante não pode atuar como revisor da própria despesa.
Contraste: a equipe Boreal tem teto de alimentação de R$ 190 e exige três revisores para despesas extraordinárias; suas regras não se aplicam à equipe Aurora.
Hospedagem: este manual não define limite de diárias de hotel para nenhuma equipe. Consulte o departamento responsável; não deduza valores de alimentação ou transporte.
Cancelamento: o envio de uma solicitação não executa pagamentos. Estes dados são sintéticos e não autorizam ações externas.
'''

def test_expanded_retrieval_model_concurrency_and_crash():
    s=Installation();started=time.perf_counter();rows=[];envelopes=[];metrics=[]
    def now():return datetime.now(timezone.utc).isoformat()
    def save(name,value):(HERE/'evidence'/name).write_text(json.dumps(value,ensure_ascii=False,indent=2),encoding='utf-8')
    def mark(name,**kw):s.evidence['scenarios'].append({'name':name,**kw});print('CHECKPOINT '+name,flush=True)
    def calls():
        p=s.state/'model-budget.json';return json.loads(p.read_text())['calls'] if p.exists() else 0
    def deny(fn,status):
        with pytest.raises(Rejected) as e:fn()
        assert e.value.status==status
    def payload(q):return {'request_id':str(uuid.uuid4()),'source':'politica-remoto','question':q,'as_of':'2026-02-01T00:00:00Z','known_at':cut}
    def grade(case,text):return bool(re.search(case[2],text,re.I))
    def arm(stage):
        state=Path(s.app_config['state']);(state/'fault-arm.json').write_text(json.dumps({'stage':stage}));(state/'fault-reached.json').write_text('{}')
    def interrupted(p,stage):
        arm(stage)
        with cf.ThreadPoolExecutor(1) as pool:
            f=pool.submit(s.call,'analista','/advise',p)
            checkpoint=Path(s.app_config['state'])/'fault-reached.json'
            for _ in range(900):
                if json.loads(checkpoint.read_text()).get('stage')==stage:break
                if f.done():f.result();raise AssertionError('fault not reached')
                time.sleep(.2)
            else:raise AssertionError('fault deadline')
            s.stop_app()
            try:f.result(timeout=20)
            except Exception as e:save('disconnect-'+stage+'.json',{'exception':type(e).__name__,'message':str(e)})
        s.start_app()
    try:
        save('protocol.json',{'cases':CASES,'corpus':CORPUS,'modes':['mix','naive'],'generation_models':['gpt-6.1-terra','gpt-6.1-sol'],
             'call_cap':40,'concurrent_identical_requests':8,'faults':['after_admission','after_receipt'],
             'scope':'one application process; synthetic corpus; fixed-prompt Sol comparison, no full factorial; no statistical accuracy claim'})
        s.start()
        raw='---\nsource: politica-remoto\nversion: 1\nvalid_at: 2026-01-01T00:00:00Z\ndomain: publico\n---\n'+CORPUS
        path=Path(s.app_config['vault'])/'manual.md';path.write_text(raw,encoding='utf-8')
        d=s.call('analista','/drafts',{'path':path.name});s.call('aprovador','/review',{'id':d['id'],'raw_sha':d['raw_sha']});s.call('aprovador','/publish',{'id':d['id']});cut=now()
        mark('approved_corpus_predeclared_oracles')
        for mode in ['mix','naive']:
            if mode!='mix':s.stop_app();os.environ['AUDIT_RETRIEVAL']=mode;s.start_app()
            for n,case in enumerate(CASES):
                p=payload(case[1]);before=calls();t=time.perf_counter()
                if mode=='mix' and n==0:
                    with cf.ThreadPoolExecutor(8) as pool:answers=list(pool.map(lambda _:s.call('analista','/advise',p),range(8)))
                    assert all(a==answers[0] for a in answers)
                    assert s.sql("SELECT count(*) FROM decisions WHERE id='"+p['request_id']+"'",'pilot')=='1'
                    out=answers[0];mark('eight_identical_concurrent_requests_one_record',calls=calls()-before)
                else:out=s.call('analista','/advise',p)
                r=json.loads(out['record_json']);text=r['response'].get('llm_response',{}).get('content','')
                assert hashlib.sha256(out['record_json'].encode()).hexdigest()==out['sha256']
                row={'case':case[0],'mode':mode,'model':'gpt-6.1-terra','answer':text,'value_or_abstention':grade(case,text),
                     'citation':bool(re.search(r'\[\d+\]',text)) and 'politica-remoto@v1.md' in text,'calls':calls()-before,'seconds':time.perf_counter()-t}
                rows.append(row);envelopes.append({'input':p,'envelope':out});save('acceptance.json',rows);save('decisions.json',envelopes)
                metrics.append({'mode':mode,'case':case[0],'call_ids':r['provider_call_ids']})
            mark('retrieval_comparison_'+mode)
        # Replay exactly the four final mix prompts with Sol. Same evidence/context, no retrieval rerun.
        provider=CodexProvider({**s.app_config,'model_name':'gpt-6.1-sol'})
        for case,entry in zip(CASES,metrics[:4]):
            number=entry['call_ids'][-1];prompt=json.loads((HERE/'evidence'/f'llm-{number:02}.prompt.json').read_text(encoding='utf-8'))
            before=calls();text=provider.run(prompt['user_prompt'],prompt['system_prompt'],prompt['history_messages'])
            rows.append({'case':case[0],'mode':'mix_fixed_prompt','model':'gpt-6.1-sol','answer':text,'value_or_abstention':grade(case,text),
                         'citation':bool(re.search(r'\[\d+\]',text)) and 'politica-remoto@v1.md' in text,'calls':calls()-before,'baseline_prompt_call':number})
            save('acceptance.json',rows)
        mark('sol_on_same_four_final_prompts')
        # Native response produced, durable receipt stored, process killed before decisions commit.
        crash=payload('Informe o teto diário de transporte da equipe Aurora e cite sua fonte.');interrupted(crash,'after_receipt');b=calls()
        deny(lambda:s.call('analista','/advise',crash),503)
        deny(lambda:s.call('analista','/reconcile',{'request_id':crash['request_id']}),403)
        recovered=s.call('aprovador','/reconcile',{'request_id':crash['request_id']})
        assert s.call('analista','/advise',crash)==recovered and calls()==b
        assert s.call('aprovador','/reconcile',{'request_id':crash['request_id']})==recovered and calls()==b
        mark('crash_after_receipt_governance_reconciliation_no_regeneration')
        # A receipt cannot override a grant revoked while the process was down.
        revoked=payload('Qual equipe usa o teto de alimentação de R$ 190?');interrupted(revoked,'after_receipt');b=calls()
        analyst=next(p['id'] for p in s.principals if p['name']=='analista')
        s.call('aprovador','/admin/revoke',{'principal':analyst,'source':'politica-remoto'})
        deny(lambda:s.call('aprovador','/reconcile',{'request_id':revoked['request_id']}),403);assert calls()==b
        assert s.sql("SELECT count(*) FROM decisions WHERE id='"+revoked['request_id']+"'",'pilot')=='0'
        mark('revocation_prevents_receipt_promotion')
        # Finance still has public access. No receipt is explicitly unrecoverable automatically.
        uncertain=payload('Qual o procedimento de cancelamento?');arm('after_admission')
        # interrupted helper always uses analyst: use board-authorized lab fixture grant restoration only for this distinct scenario.
        s.sql("INSERT INTO grants VALUES('"+analyst+"','politica-remoto')",'pilot')
        interrupted(uncertain,'after_admission');b=calls()
        deny(lambda:s.call('analista','/advise',uncertain),503)
        deny(lambda:s.call('aprovador','/reconcile',{'request_id':uncertain['request_id']}),503);assert calls()==b
        mark('no_receipt_remains_fenced_without_blind_retry')
        s.evidence.update(result='PASS_CONTRACTS',execution_completed=True,elapsed_seconds=time.perf_counter()-started,
             semantic_passed=sum(r['value_or_abstention'] for r in rows),semantic_total=len(rows),model_calls=calls())
    except Exception as e:
        s.evidence.update(result='FAIL',error=str(e),elapsed_seconds=time.perf_counter()-started);raise
    finally:
        os.environ.pop('AUDIT_RETRIEVAL',None);s.close()
