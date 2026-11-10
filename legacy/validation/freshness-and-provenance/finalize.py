import hashlib,json,subprocess,zipfile
from pathlib import Path
from freshness import verify
P=Path(__file__).parent;R=P.parents[1];E=P/'evidence'
def read(p):return json.loads(p.read_text(encoding='utf-8'))
def digest(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def main():
    r=read(E/'integration.json');cases=read(E/'acceptance.json');revised=read(E/'acceptance-revised.json')
    calls=[json.loads(x) for x in (E/'model-calls.jsonl').read_text(encoding='utf-8').splitlines()]
    proofs=[json.loads(x) for x in (E/'freshness-requests.jsonl').read_text(encoding='utf-8').splitlines()]
    for p in proofs:verify(p['proof'],r['freshness_authority']['public_key'],r['installation'],p['request']['nonce'],now=p['request']['issued'])
    usage={k:sum(u.get(k,0) for c in calls for u in c['usage']) for k in ['input_tokens','cached_input_tokens','output_tokens','reasoning_output_tokens']}
    expected={'metadata_only_validity_and_caller_cannot_override_backend','source_approval_publication_and_decisions_advance_retained_authority',
        'coherent_old_backup_denied_for_missing_postbackup_operations','latest_complete_bundle_opens_and_exact_old_advice_needs_no_model','unconfirmed_authority_intent_stays_fenced_after_restart_without_inference'}
    operational=bool(r.get('execution_completed') and expected<={x['name'] for x in r['scenarios']})
    summary={'integrated_original_result':r['result'],'operational_checkpoints':'PASS' if operational else 'INCOMPLETE',
        'original_temporal_grader_passed':sum(all(c['checks'].values()) for c in cases),'revised_offline_passed':sum(all(c['revised_checks'].values()) for c in revised),'temporal_total':len(cases),
        'full_e2e_after_grader_revision':'NOT_RUN','unit_python_security':2,'unit_python_grader':8,'recorded_output_checks':4,'unit_typescript':2,'typecheck':'PASS','proofs_verified_offline':len(proofs),'model_calls':len(calls),'usage':usage,
        'model_tool_events':sum(c['unexpected_tool_events'] for c in calls),'production':'NO_GO','elapsed_seconds':r['elapsed_seconds'],'cleanup':r['cleanup']}
    (E/'summary.json').write_text(json.dumps(summary,ensure_ascii=False,indent=2),encoding='utf-8')
    text=f'''# Atualidade e proveniência temporal — resultado de 04/11/2026

**E2E original: {r['result']}**, {r['elapsed_seconds']:.2f} s antes da limpeza. Os cinco checkpoints operacionais: **{summary['operational_checkpoints']}**. O grader original marcou {summary['original_temporal_grader_passed']}/{len(cases)}; a revisão do critério de início/fim, aplicada offline às mesmas saídas, marcou **{summary['revised_offline_passed']}/{len(cases)}**, sem nova inferência. O E2E completo não foi repetido após corrigir o grader. Produção continua NO-GO; a evidência permite continuar a qualificação do protótipo.

Passaram dois unitários de segurança Python, oito regressões do grader, quatro checks de saídas já gravadas, dois testes TypeScript e typecheck strict.

## Checkpoints

'''
    for x in r['scenarios']:text+='- '+x['name']+'\n'
    text+='\n## Respostas preservadas\n\n'
    for c,v in zip(cases,revised):text+=f"**{c['case']}** — checks originais: {json.dumps(c['checks'],ensure_ascii=False)}; no_missing_date_claim revisado: {v['revised_checks']['no_missing_date_claim']}\n\n{c['answer']}\n\n"
    text+='''## O que mudou e o que o ensaio cobre

O backend continua selecionando a fonte aprovada por vigência/conhecimento. O contrato TypeScript valida conteúdo e cortes, separa vigência inicial de publicação e fornece os metadados explicitamente à geração. Não há datas no corpo das duas notas da fixture. A API registra canonical_basis junto com a resposta original e não aceita valid_from escolhido pelo caller. Isso trata o problema observado na rodada anterior sem editar suas respostas/evidências nem pedir ao modelo que determine validade ou permissões.

Um atributo não informado (tamanho da equipe) continuou sem valor factual. O grader verifica projeto, data, seleção/versão, citação e ausência da ressalva de data canônica ausente; não é uma medida estatística, entailment por todas as afirmações ou garantia geral de qualidade. Os quatro casos e prompts são públicos nesta fixture e podem não representar dados empresariais.

**Falha do avaliador preservada:** o regex original confundiu “não há informação sobre o fim da vigência” com ausência de início. Três respostas explicitavam o início correto e a publicação, mas receberam falso negativo. O arquivo acceptance.json, o JUnit, console e o teste original em evidence/test-integrated-original.py.txt continuam intactos. O novo grader foi testado contra oito exemplos positivos/negativos, incluindo a frase problemática da rodada anterior e ausência de início/fim juntos; a revisão pós-hoc das quatro saídas está em acceptance-revised.json com hashes das respostas. Não se trata de benchmark independente nem de repetição do E2E; a correção foi aplicada ao teste para execuções futuras.

A autoridade retida registra intenção antes da mutação e confirmação após recibo local. Provas Ed25519 vinculam nonce, tempo, instalação e inventário completo de operações. A API tem chave pública, não a privada de assinatura. Os unitários recusaram prova repetida com nonce errado, instalação errada, prova expirada/adulterada e reuso de ID com outra entrada/resultado. Dois erros de preparação de tmp_path foram preservados e resolvidos com diretório próprio; não foram falhas do contrato nem consumiram inferência.

No restore antigo g1, o bundle ainda era coerente internamente, porém não continha as aprovações/publicação/decisões posteriores confirmadas pela autoridade. O gate recusou a abertura e a leitura de respostas, inclusive após restart, sem novas chamadas de modelo. Não houve override para aceitar perda de dados. O restore g2, atual naquele checkpoint e com inventário conjunto coincidente, pôde ser aberto por governança; leituras/replays antigos retornaram os mesmos registros sem modelo. Consulta inédita depois do restore exerceu novamente o índice/geração.

A falha final ocorreu depois de a autoridade gravar intenção e antes de haver admissão/recibo local. Reiniciar deixou a aplicação bloqueada e nenhum modelo foi chamado para tentar resolver a incerteza. Isso demonstra fence conservador, não recuperação/alta disponibilidade desse caso. Não foi implementada conciliação/encerramento da intenção abandonada. A autoridade retém testemunho/digests, não cópia dos dados perdida capaz de restaurá-los.

## Limites e decisão

- Autoridade em processo/SQLite separado no mesmo host, fora dos bundles. Não prova DR externo, KMS, inviolabilidade ou resistência ao rollback da própria autoridade. Canal loopback/HMAC, relógio local; não SSO/TLS empresarial.
- Não há transação distribuída. Hooks para closure, autorização de substituto e conciliação existem, mas não foram exercitados neste E2E; a cobertura anterior dessas funções não se transfere automaticamente à combinação nova.
- Nenhum conector externo real forneceu inventário de documentos. A atualidade testada é a dos eventos próprios instrumentados. Caminhos não instrumentados ou edições diretas privilegiadas não são cobertos. Drafts não aprovados não têm recuperação de alta prioridade comprovada.
- Locks, contador de chamadas e API são de um processo. Admissão, orçamento, leases/limites concorrentes, crash durante inferência, PITR/HA, corpus e carga empresariais continuam gates.
- Controles Python são bancada. Mantêm-se camada empresarial TypeScript, motores Python, cérebro central, instalação dedicada, LangGraph como único owner, Chief of Staff, A0–A4, equipes por capacidades e JARVIS como requisitos ainda não homologados integralmente. Editorial e novo contrato de proveniência são TypeScript reais. Obsidian continua opcional sem UI testada; Graphiti não é aprovado como autoridade histórica exclusiva.

**Decisão:** continuar o protótipo; não liberar produção. O próximo gate é conciliar intenções e commits interrompidos sem duplicação, e qualificar admissão/orçamento entre dois processos. A implantação real da autoridade e a recuperação de dados posteriores perdidos exigem desenho/teste próprios. Não houve troca antecipada do motor nem aprovação geral de modelo/arquitetura.
'''
    text+=f"\nUso desta execução: {len(calls)} chamadas Terra, cap 40; {json.dumps(usage,ensure_ascii=False)}. Provas offline verificadas: {len(proofs)}; eventos de ferramentas do modelo: {summary['model_tool_events']}. Custo monetário atribuível continua sem medição.\n"
    if r['result']!='PASS':text+='\nFalha preservada: '+r.get('error','ver acceptance e console')+'\n'
    (P/'RESULTS.md').write_text(text,encoding='utf-8')
    vendors={}
    for n in ['paperclip','LightRAG','langgraph','graphiti-audit']:
        q=R/'vendor'/n;vendors[n]={'sha':subprocess.run(['git','-C',str(q),'rev-parse','HEAD'],capture_output=True,text=True).stdout.strip(),'status':subprocess.run(['git','-C',str(q),'status','--porcelain'],capture_output=True,text=True).stdout.strip()}
    files=sorted([f for f in P.iterdir() if f.is_file() and f.name not in ('manifest.json','package-result.json')]+[f for f in E.rglob('*') if f.is_file()])
    (P/'manifest.json').write_text(json.dumps({'files':{str(f.relative_to(P)):digest(f) for f in files},'vendors':vendors,'summary':summary},ensure_ascii=False,indent=2),encoding='utf-8')
    target=R/'atualidade_proveniencia_2026-11-04.zip'
    with zipfile.ZipFile(target,'w',zipfile.ZIP_DEFLATED) as z:
        for f in files+[P/'manifest.json']:z.write(f,'freshness-and-provenance/'+str(f.relative_to(P)))
    result={'path':str(target),'sha256':digest(target),'bytes':target.stat().st_size};(P/'package-result.json').write_text(json.dumps(result,indent=2),encoding='utf-8');print(json.dumps({'summary':summary,'package':result},indent=2))
if __name__=='__main__':main()
