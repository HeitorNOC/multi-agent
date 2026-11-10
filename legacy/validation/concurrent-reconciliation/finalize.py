import hashlib,json,subprocess,zipfile
from pathlib import Path
from freshness import verify
P=Path(__file__).parent;R=P.parents[1];E=P/'evidence'
def read(p):return json.loads(p.read_text(encoding='utf-8'))
def digest(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def main():
    r=read(E/'integration.json');final=read(E/'final-proof.json');stress=read(E/'budget-stress.json')
    calls=[json.loads(x) for x in (E/'model-calls.jsonl').read_text(encoding='utf-8').splitlines()]
    proofs=[json.loads(x) for x in (E/'freshness-requests.jsonl').read_text(encoding='utf-8').splitlines()]
    for p in proofs:verify(p['proof'],r['freshness_authority']['public_key'],r['installation'],p['request']['nonce'],now=p['request']['issued'])
    assert len({c['call'] for c in calls})==len(calls)==final['budgets']['model']['reserved']
    assert sorted(c['call'] for c in calls)==list(range(1,len(calls)+1))
    assert len({c['instance'] for c in calls})>=2
    usage={k:sum(u.get(k,0) for c in calls for u in c['usage']) for k in ['input_tokens','cached_input_tokens','output_tokens','reasoning_output_tokens']}
    granted=[sum(row['granted'] for row in rows) for rows in stress['process_results']]
    summary={'integrated_result':r['result'],'elapsed_seconds':r['elapsed_seconds'],'checkpoints':len(r['scenarios']),
        'model_calls':len(calls),'actual_model_instances':len({c['instance'] for c in calls}),'global_call_ids_unique':True,
        'stress_attempts':sum(len(x) for x in stress['process_results']),'stress_accepted_by_process':granted,'stress_reserved':final['budgets']['stress']['reserved'],
        'unit_authority':2,'unit_replay_acl_after_fix':3,'full_e2e_after_replay_acl_fix':'NOT_RUN','proofs_verified':len(proofs),
        'usage':usage,'model_tool_events':sum(c['unexpected_tool_events'] for c in calls),'production':'NO_GO','cleanup':r['cleanup']}
    (E/'summary.json').write_text(json.dumps(summary,ensure_ascii=False,indent=2),encoding='utf-8')
    text=f'''# Conciliação e concorrência — 04/11/2026

**E2E: {r['result']}**, {r['elapsed_seconds']:.2f} s antes da limpeza; console pytest 205,23 s incluindo limpeza. Oito checkpoints passaram. Dois unitários de autoridade e typecheck strict passaram. Correção adicional de replay editorial depois do E2E: três regressões isoladas passaram; não se repetiu o E2E completo após essa mudança de ordem da checagem de grant. **Continuar o protótipo; produção permanece NO-GO.**

## Evidências observadas

'''
    for x in r['scenarios']:text+='- '+x['name']+'\n'
    text+=f'''
**Duas APIs reais.** Oito pedidos iguais foram enviados alternadamente a dois processos com PIDs distintos. Retornaram envelopes idênticos, com uma única admission e decisão. Pedidos diferentes também concluíram pelas duas APIs; logs de inferência mostram {summary['actual_model_instances']} IDs de instância ao longo do ensaio/reinícios. Todos os {len(calls)} IDs globais de chamada foram únicos e contínuos. O mecanismo é exclusão PG por instalação: não é demonstração de throughput empresarial nem inferências de negócio paralelas.

**Conciliação com recibo.** As falhas reais depois do recibo empresarial e depois do recibo de atualidade foram recuperadas por governança, com grants atuais do operador e proprietário. A réplica sobrevivente reconheceu a pendência e bloqueou a repetição. A recuperação reutilizou bytes/hash do recibo original, recompôs o registro quando necessário e confirmou a mesma operação na autoridade. Não houve inferência adicional para conciliar ou reler; replay da conciliação permaneceu seguro.

**Sem recibo.** Queda depois da intenção, antes da admission, manteve resultado desconhecido. Reconciliação automática recusada. Houve proposta com evidência/motivo e confirmação por segunda identidade board autorizada; autor da proposta, analista e board com grant revogado foram recusados nos caminhos inadequados. O resultado ficou explicitamente closed_unknown, sem resposta final inventada nem mudança para sucesso. Tombstone bloqueou o ID original e o mesmo fingerprint com outro ID. Serviço reabriu após confirmação consistente. Retry exato do encerramento retornou o mesmo resultado. Não existe ainda substituição autorizada automática para esse tipo de intenção sem admission; reformulações semânticas não são deduplicadas por fingerprint.

**Reservas atômicas.** Dois processos OS independentes disputaram 20 reservas sem executar modelos no escopo stress. Foram admitidas {sum(granted)} (distribuição {granted}), numeradas 1–7, e 13 foram recusadas. Retry com ID já reservado retornou o mesmo número sem consumir outra vaga. A autoridade e ambas as APIs reiniciaram, mantendo stress=7 e model={final['budgets']['model']['reserved']}; respostas antigas e tombstone permaneceram. Os limites foram definidos no servidor, não pelo caller. SQLite/serviço central único não equivalem a autoridade em HA.

**ACL editorial.** Revogação anterior à primeira review/publicação foi respeitada no E2E; não criou intenção de aprovação negada. Uma revisão final encontrou que o replay de publicação já concluída retornava antes de allowed(). Teste isolado executando o corpo real da rota demonstrou dois failures/um pass; foi movida a checagem para antes do retorno idempotente e os três testes passaram. Source pré-correção, falhas e resultados verdes estão preservados. A mudança não altera as rotas de conciliação/budget ensaiadas. Não se repetiu o E2E completo depois desse ajuste; isso não homologa revogação em todas as janelas de commit.

## Uso e interpretação

Foram {len(calls)} execuções reais Codex Terra, cap 40 de reservas no escopo model. Tokens reportados: {json.dumps(usage,ensure_ascii=False)}. Eventos de ferramentas: {summary['model_tool_events']}. Provas Ed25519 verificadas offline: {len(proofs)}. Nenhum gasto monetário atribuível foi medido. Reserva conta tentativa CLI; pode haver consumo incerto se o cliente morrer antes/depois do spawn. Não há refund automático, exactly-once de inferência ou equivalência entre chamada CLI, request HTTP interno, tokens e custo.

As respostas de assessoramento são sintéticas e estão preservadas em decisions.json. Este não foi novo benchmark semântico, de modelos ou de citações; o foco é protocolo operacional, concorrência e orçamento. Não se requalifica a acurácia geral por preservar uma saída. O resultado anterior do grader temporal e sua revisão offline continuam preservados no diretório anterior.

## Limites que ainda bloqueiam produção

- PG serializa o trabalho de negócio de toda a instalação. Não houve carga/corpus empresarial, fairness, cancelamento durante inferência, queda do banco com sessão perdida, partição de rede ou lock mantido por sessão travada. Não foi testado um modelo de leases/fencing com execução concorrente de múltiplas tarefas.
- Conciliação qualificada apenas para decisões nas três janelas testadas. Intenções editoriais/closure/substituição e todas as combinações de revogação, commit e ACK ainda exigem teste. Reabertura não pode ignorar joint_restore; essa combinação precisa ser novamente exercitada.
- Esta versão acrescenta contexto/outcome na autoridade, tabelas de proposta/tombstone/auditoria e orçamento retido. Restore conjunto desta versão não foi refeito. Inventário, migração e recuperação precisam cobrir os novos estados e impedir ressuscitar IDs fechados ou zerar reservas. Resultados de restore anteriores não se transferem automaticamente.
- Autoridade no mesmo host, chave privada retida em memória do harness para o restart, sem KMS/DR externo, HA ou proteção contra rollback da própria autoridade/DBA comprometido. Journal de revogação em arquivo não foi substituído por serviço distribuído; caminhos que não participam dos locks não têm a mesma garantia.
- Controles Python são bancada; camada empresarial final TypeScript e integração a LangGraph permanecem gates. Editorial e proveniência TypeScript são reais. Instalação dedicada, cérebro central, LangGraph único owner, equipes por capacidades, Chief of Staff e A0–A4 são requisitos mantidos, não homologação do produto completo. Sandbox/gateway, SSO/TLS/cofre, conectores e JARVIS continuam pendentes; Obsidian opcional sem UI ensaiada. Graphiti não é autoridade histórica exclusiva.

**Próximo gate:** consolidar restauração/atualização desta versão com dois processos, incluindo reservas e tombstones retidos, e depois medir carga representativa com limites de custo reais. Completar a camada empresarial TypeScript e o controlador, sem introduzir segundo motor de workflow. Nenhuma ferramenta está aprovada por antecipação.
'''
    if r['result']!='PASS':text+='\nFalha preservada: '+r.get('error','ver console')+'\n'
    (P/'RESULTS.md').write_text(text,encoding='utf-8')
    vendors={}
    for n in ['paperclip','LightRAG','langgraph','graphiti-audit']:
        q=R/'vendor'/n;vendors[n]={'sha':subprocess.run(['git','-C',str(q),'rev-parse','HEAD'],capture_output=True,text=True).stdout.strip(),'status':subprocess.run(['git','-C',str(q),'status','--porcelain'],capture_output=True,text=True).stdout.strip()}
    files=sorted([f for f in P.iterdir() if f.is_file() and f.name not in ('manifest.json','package-result.json')]+[f for f in E.rglob('*') if f.is_file()])
    (P/'manifest.json').write_text(json.dumps({'files':{str(f.relative_to(P)):digest(f) for f in files},'vendors':vendors,'summary':summary},ensure_ascii=False,indent=2),encoding='utf-8')
    target=R/'conciliacao_concorrencia_2026-11-04.zip'
    with zipfile.ZipFile(target,'w',zipfile.ZIP_DEFLATED) as z:
        for f in files+[P/'manifest.json']:z.write(f,'concurrent-reconciliation/'+str(f.relative_to(P)))
    out={'path':str(target),'sha256':digest(target),'bytes':target.stat().st_size};(P/'package-result.json').write_text(json.dumps(out,indent=2),encoding='utf-8');print(json.dumps({'summary':summary,'package':out},indent=2))
if __name__=='__main__':main()
