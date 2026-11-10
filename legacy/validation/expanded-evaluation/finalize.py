import hashlib,json,subprocess,zipfile
from pathlib import Path
P=Path(__file__).parent;R=P.parents[1];E=P/'evidence'
def read(p):return json.loads(p.read_text(encoding='utf-8'))
def digest(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def main():
    result=read(E/'integration.json');rows=read(E/'acceptance.json')
    calls=[json.loads(x) for x in (E/'model-calls.jsonl').read_text(encoding='utf-8').splitlines()]
    byid={c['call']:c for c in calls};pairs=[]
    for r in rows:
        if r['model']=='gpt-6.1-sol':
            c=next(c for c in calls if c['model']==r['model'] and c['call']>r['baseline_prompt_call'] and c['prompt_sha256']==byid[r['baseline_prompt_call']]['prompt_sha256'])
            pairs.append({'case':r['case'],'terra_call':r['baseline_prompt_call'],'sol_call':c['call'],'exact_prompt_sha256':c['prompt_sha256']})
    (E/'fixed-prompt-pairs.json').write_text(json.dumps(pairs,indent=2),encoding='utf-8')
    usage={k:sum(u.get(k,0) for c in calls for u in c['usage']) for k in ['input_tokens','cached_input_tokens','output_tokens','reasoning_output_tokens']}
    embeds=[json.loads(x) for x in (E/'embedding-calls.jsonl').read_text(encoding='utf-8').splitlines()]
    summary={'result':result['result'],'cases':len(rows),'value_or_abstention_passed':sum(r['value_or_abstention'] for r in rows),
        'citation_passed':sum(r['citation'] for r in rows),'calls':len(calls),'usage':usage,'model_tool_events':sum(c['unexpected_tool_events'] for c in calls),
        'fixed_prompt_pairs':len(pairs),'embedding_vectors':sum(x['batch'] for x in embeds),'embedding_truncated_inputs':sum(x['truncated_inputs'] for x in embeds),
        'cleanup':result['cleanup'],'elapsed_seconds':result['elapsed_seconds']}
    (E/'summary.json').write_text(json.dumps(summary,ensure_ascii=False,indent=2),encoding='utf-8')
    text=f'''# Resultado — ensaio ampliado, 04/11/2026

Contratos: **{result['result']}**; duração {result['elapsed_seconds']:.2f} s antes da limpeza. Resultado semântico: {summary['value_or_abstention_passed']}/{len(rows)} no critério lexical de valor/abstenção. Citação/filename: {summary['citation_passed']}/{len(rows)}, avaliados separadamente. Não é medida de acurácia empresarial ou suporte de todas as afirmações.

| Modelo / recuperação | Caso | Valor ou abstenção | Citação/arquivo |
|---|---|---|---|
'''
    for r in rows:text+=f"| {r['model']} / {r['mode']} | {r['case']} | {'PASS' if r['value_or_abstention'] else 'FAIL'} | {'PASS' if r['citation'] else 'FAIL'} |\n"
    text+='\n## Evidências operacionais\n\n'
    for x in result['scenarios']:text+='- '+x['name']+'\n'
    text+=f'''
Oito pedidos simultâneos iguais foram serializados por um único processo, com um registro e envelopes iguais. Isso comprova deduplicação no recorte, não oito inferências paralelas, escalabilidade empresarial ou concorrência entre réplicas. A chamada inicial também inclui ingestão; não confundir um pedido único com uma única chamada ao modelo.

Houve terminação real do processo da aplicação, não simulação de retorno HTTP. Após o recibo durável, o pedido continuou pendente até conciliação explícita por governança. A conciliação promoveu o texto original sem regenerar resposta; revogação atual impediu promover outro recibo. Verificação SQL independente durante a execução recusou UPDATE/DELETE nos recibos ao papel runtime (exit 3, permission denied; receipt-permissions.json). Sem recibo, o pedido continuou bloqueado após reinício e a conciliação recusou a retomada automática. Esse último cenário é um limite operacional observado, não recuperação concluída.

Ainda existe janela entre retorno do modelo e gravação do recibo. Não há confirmação durável do provedor que permita recompor uma saída perdida nessa janela sem nova inferência. A admissão interrompida antes do recibo permanece pendente para investigação; não foi implementado encerramento compensatório com novo ID/aprovação. Não foram testados desastre de banco, perda de disco, backup conjunto, PITR, failover ou múltiplos writers.

## Modelos, recuperação e uso

Mix e naive usaram a mesma projeção de fonte/embeddings/extração Terra; modo está no fingerprint e no registro, sem caller escolher workspace. Quatro prompts finais mix foram repetidos exatamente no Sol, com hashes iguais verificados em fixed-prompt-pairs.json. Sol não refez extração nem recuperação. Essa comparação controlada de geração não determina o melhor modelo em geral. Corpus único com distratores Aurora/Boreal, quatro perguntas, uma passagem, ordem fixa e sem testes estatísticos. As respostas completas e todos os prompts estão preservados em acceptance.json e llm-*.prompt.json; não houve reclassificação de falhas ou repetição silenciosa.

Foram {len(calls)} chamadas reais, cap 40 por instalação; tokens de uso: {json.dumps(usage,ensure_ascii=False)}. Eventos de ferramentas no modelo: {summary['model_tool_events']}. Chamadas não equivalem a custo financeiro atribuível: esse custo continua sem medição. Latências incluem cache, ingestão inicial e ordem fixa; não servem como tabela de preço/performance entre modelos.

## Decisão

Continuar a qualificação do protótipo, **não aprovar produção**. O recibo durável fecha parte da lacuna de retomada, mas não oferece exactly-once de inferência nem recuperação para todo ponto de falha. Escolha de modelo e modo permanece condicionada a casos adicionais representativos e medição de custo. Nenhum resultado desta rodada torna Graphiti autoridade histórica ou substitui o ledger canônico.

Próximos gates: política de encerramento/revisão para admissões sem recibo; concorrência entre processos com admissão/budget transacionais; backup/restauração conjunta incluindo SQLite editorial, PostgreSQL, Neo4j, chaves e journal de revogação; corpus de múltiplas fontes com ACL, carga realista e avaliação de suporte por afirmação. LangGraph permanece único owner; Chief of Staff, A0–A4, equipes dinâmicas, SSO/TLS/cofre, sandbox integrada, conectores empresariais e JARVIS ainda exigem homologação própria. Obsidian continua editor opcional sem UI ensaiada.
'''
    (P/'RESULTS.md').write_text(text,encoding='utf-8')
    files=sorted([p for p in P.iterdir() if p.is_file() and p.name not in ('manifest.json','package-result.json')]+[p for p in E.rglob('*') if p.is_file()])
    vendors={}
    for name in ['paperclip','LightRAG','langgraph','graphiti-audit']:
        q=R/'vendor'/name
        if q.exists():vendors[name]={'sha':subprocess.run(['git','-C',str(q),'rev-parse','HEAD'],capture_output=True,text=True).stdout.strip(),
                                    'status':subprocess.run(['git','-C',str(q),'status','--porcelain'],capture_output=True,text=True).stdout.strip()}
    manifest={'files':{str(p.relative_to(P)):digest(p) for p in files},'vendors':vendors,'summary':summary}
    (P/'manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2),encoding='utf-8')
    target=R/'ensaio_ampliado_2026-11-04.zip'
    with zipfile.ZipFile(target,'w',zipfile.ZIP_DEFLATED) as z:
        for p in files+[P/'manifest.json']:z.write(p,'expanded-evaluation/'+str(p.relative_to(P)))
    package={'path':str(target),'sha256':digest(target),'bytes':target.stat().st_size}
    (P/'package-result.json').write_text(json.dumps(package,indent=2),encoding='utf-8');print(json.dumps({'summary':summary,'package':package},indent=2))
if __name__=='__main__':main()
