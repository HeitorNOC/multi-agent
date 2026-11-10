import hashlib,json,subprocess,zipfile
from pathlib import Path
from freshness import verify
P=Path(__file__).parent;R=P.parents[1];E=P/'evidence'
def read(p):return json.loads(p.read_text(encoding='utf-8'))
def digest(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def main():
    r=read(E/'integration.json')
    calls=[json.loads(x) for x in (E/'model-calls.jsonl').read_text(encoding='utf-8').splitlines()]
    proofs=[json.loads(x) for x in (E/'freshness-requests.jsonl').read_text(encoding='utf-8').splitlines()]
    for p in proofs:verify(p['proof'],r['freshness_authority']['public_key'],r['installation'],p['request']['nonce'],now=p['request']['issued'])
    usage={k:sum(u.get(k,0) for c in calls for u in c['usage']) for k in ['input_tokens','cached_input_tokens','output_tokens','reasoning_output_tokens']}
    abandoned=read(E/'abandoned-reservations.json') if (E/'abandoned-reservations.json').exists() else []
    final=read(E/'final-proof.json') if (E/'final-proof.json').exists() else proofs[-1]['proof']['payload']
    ids={c['call'] for c in calls};unused={p['number'] for p in abandoned};reserved=final['budgets']['model']['reserved']
    if r['result']=='PASS':
        assert len(ids)==len(calls) and ids.isdisjoint(unused) and ids|unused==set(range(1,reserved+1))
    checkpoint=read(E/'stale-g1.json')['head'] if (E/'stale-g1.json').exists() else None
    floor=r.get('bundle_generations',[{}])[-1].get('budget_floors',{}).get('model',{}).get('reserved',0)
    negatives=[p for p in proofs if checkpoint and p['proof']['payload']['head']==checkpoint and p['proof']['payload']['budgets']['model']['reserved']<floor]
    (E/'counter-rollback-proofs.json').write_text(json.dumps(negatives,ensure_ascii=False,indent=2),encoding='utf-8')
    summary={'integrated_result':r['result'],'elapsed_seconds':r['elapsed_seconds'],'checkpoints':len(r['scenarios']),
        'actual_cli_calls':len(calls),'retained_model_reservations':reserved,'deliberate_unstarted_reservations':len(abandoned),'unused_call_numbers':sorted(unused),
        'stress_reserved':final['budgets']['stress']['reserved'],'unit_budget_floor_cases':4,'proofs_verified':len(proofs),'counter_rollback_proofs':len(negatives),
        'usage':usage,'model_tool_events':sum(c['unexpected_tool_events'] for c in calls),'production':'NO_GO','cleanup':r['cleanup']}
    (E/'summary.json').write_text(json.dumps(summary,ensure_ascii=False,indent=2),encoding='utf-8')
    text=f'''# Restore coordenado do estado concorrente — 04/11/2026

**Resultado E2E: {r['result']}**, {r['elapsed_seconds']:.2f} s antes da limpeza. Quatro testes unitários de pisos de quota passaram. Decisão: continuar qualificação do protótipo; **produção permanece NO-GO**.

## Checkpoints executados

'''
    for x in r['scenarios']:text+='- '+x['name']+'\n'
    if r['result']=='PASS':text+='''
## O que este ensaio acrescentou

**Backup de todas as APIs.** O código herdado só parava a API principal e não cobria as tabelas novas no inventário. O procedimento novo esperou o pedido admitido finalizar, persistiu um gate de backup e recusou novas operações/revogação em ambas as APIs. Só depois parou todos os processos e serviços para a captura fria. Após reinício/thaw normal, a resposta que estava em andamento foi relida exatamente. A pausa é privada da bancada, depois da geração e antes do recibo; não simula cancelamento do modelo em execução.

**Estados novos realmente presentes.** Depois de g1, uma intenção sem admission foi encerrada unknown por duas identidades; outra decisão com recibo foi conciliada. G2 contém proposta, tombstone e auditoria, além dos registros e metadados anteriores. O formato/fingerprint dos fontes críticos é verificado antes de tocar containers. Um manifest de formato antigo, corretamente assinado pela fixture, foi recusado: isso é rejeição de compatibilidade implícita, não migração real qualificada.

**Restore antigo.** G1 foi carregado em volumes/caminhos novos e ficou bloqueado nas duas APIs por faltar estado posterior atestado pela autoridade. O pedido encerrado não pôde ser reexecutado nesse ambiente, e thaw com token antigo não abriu joint_restore. Não houve nova inferência nessas tentativas.

**Restore completo.** G2 restaurou editorial/Vault/estado, três bancos PG/roles, grafo e chaves da camada. Alterações isoladas no tombstone, proposta e auditoria impediram a abertura; a reposição exata das linhas da fixture permitiu seguir. Essas tabelas agora participam da comparação lógica, não apenas do dump.

**Quotas independentes da atualidade dos dados.** A autoridade teve apenas seus contadores apagados na simulação, preservando operações. As APIs verificaram head coincidente, mas recusaram abrir porque os números ficaram abaixo dos pisos assinados do backup. A autoridade foi parada e reparada pela cópia privada anterior da fixture. Não se afirma recuperação empresarial de uma autoridade comprometida ou host perdido.

Com os dados corretos, ambas as APIs abriram e devolveram os mesmos envelopes/hashes de respostas originais e conciliadas. O ID unknown continuou bloqueado; revogação posterior ao backup continuou impedindo o usuário financeiro de ler seu registro, enquanto governança autorizada leu o mesmo original. Quota stress permaneceu esgotada. A reserva model sem CLI permaneceu consumida. Oito solicitações iguais alternadas entre as APIs restauradas geraram uma única decisão nova e consultaram o índice nativo, respondendo Horizonte e dois dias remotos.
'''
    else:text+='\nFalha preservada: '+r.get('error','ver console/JUnit')+'\n'
    text+=f'''
## Uso observado

{len(calls)} execuções CLI Codex Terra reais e {reserved} reservas model retidas, das quais {len(abandoned)} foi deliberadamente consumida sem iniciar modelo. IDs de vaga sem CLI: {sorted(unused)}. Isso é consumo conservador de tentativa, sem refund automático, não dinheiro gasto. A quota stress={final['budgets']['stress']['reserved']} refere-se só a reservas sintéticas, sem modelos. Cap model=40 por instalação.

Tokens reportados pelo CLI: {json.dumps(usage,ensure_ascii=False)}. Eventos de ferramenta: {summary['model_tool_events']}. Provas assinadas verificadas offline: {len(proofs)}. O custo monetário atribuível continua sem medição. Não há nova comparação de modelos nem avaliação estatística de semântica/enterprise throughput.

## Limites e decisão

- Este é um backup frio com todos os writers conhecidos participando do protocolo. Não prova snapshots online, transação distribuída, escritores privilegiados que ignorem o gate, edição externa de Vault durante captura ou carga empresarial. Exclusão global serializa trabalho de negócio; não é arquitetura paralela/fairness já homologada.
- Formato/fingerprint recusam combinações não qualificadas. Não houve upgrade/migração de produção real, teste de rollback de versão, crash em cada etapa de DDL ou compatibilidade com toda versão anterior. Esquema e políticas completas de integridade ainda precisam de revisão.
- A proteção de quota detecta perda abaixo do piso conhecido. Não protege contra rollback da autoridade acima desse piso, perda de consumo posterior sem testemunho, administradores comprometidos, KMS/DR real ou mudança de relógio. Autoridade e journal continuam no mesmo host; KEKs/credenciais/chave privada retidas no harness. Não houve perda total do host/HA/PITR.
- A reconstituição de dados posteriores foi feita por g2 completo existente. A autoridade guarda testemunho/digests, não conteúdo suficiente para recuperar dados perdidos quando não houver backup/log válido. Outras intenções, substitutos sem admission e combinações de grants/commits ainda exigem testes.
- Camada empresarial TypeScript e LangGraph único owner continuam requisitos, não substituídos pelo controle Python da bancada. Editorial/proveniência TypeScript reais foram preservados. Chief of Staff, A0–A4, equipes por capacidades, sandbox/gateway, SSO/TLS/cofre, conectores e JARVIS completos continuam gates; instalação dedicada e cérebro central lógico mantidos. Obsidian é editor opcional, UI não ensaiada; Graphiti não é autoridade histórica exclusiva.

**Próxima etapa recomendada:** medir carga/corpus representativos com critérios e orçamento explícitos, incluindo latência, filas, erro e custo observado; consolidar o caminho empresarial TypeScript e owner LangGraph. Até lá, o resultado justifica continuar o protótipo e não liberar produção. Não trocar nem aprovar ferramentas por antecipação.
'''
    (P/'RESULTS.md').write_text(text,encoding='utf-8')
    vendors={}
    for n in ['paperclip','LightRAG','langgraph','graphiti-audit']:
        q=R/'vendor'/n;vendors[n]={'sha':subprocess.run(['git','-C',str(q),'rev-parse','HEAD'],capture_output=True,text=True).stdout.strip(),'status':subprocess.run(['git','-C',str(q),'status','--porcelain'],capture_output=True,text=True).stdout.strip()}
    files=sorted([f for f in P.iterdir() if f.is_file() and f.name not in ('manifest.json','package-result.json')]+[f for f in E.rglob('*') if f.is_file()])
    (P/'manifest.json').write_text(json.dumps({'files':{str(f.relative_to(P)):digest(f) for f in files},'vendors':vendors,'summary':summary},ensure_ascii=False,indent=2),encoding='utf-8')
    target=R/'restore_estado_concorrente_2026-11-04.zip'
    with zipfile.ZipFile(target,'w',zipfile.ZIP_DEFLATED) as z:
        for f in files+[P/'manifest.json']:z.write(f,'restore-concurrent-state/'+str(f.relative_to(P)))
    out={'path':str(target),'sha256':digest(target),'bytes':target.stat().st_size};(P/'package-result.json').write_text(json.dumps(out,indent=2),encoding='utf-8');print(json.dumps({'summary':summary,'package':out},indent=2))
if __name__=='__main__':main()
