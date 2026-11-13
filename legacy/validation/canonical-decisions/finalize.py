"""Consolidate small-scope evidence and package only reviewable, non-private artifacts."""
import csv,hashlib,json,re,subprocess,sys,zipfile
from pathlib import Path
import xml.etree.ElementTree as ET
HERE=Path(__file__).resolve().parent;ROOT=HERE.parents[1];E=HERE/'evidence'
def read(p):return json.loads(p.read_text(encoding='utf-8'))
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def lines(p):return [json.loads(x) for x in p.read_text(encoding='utf-8').splitlines() if x.startswith('{')]
def files():return sorted([p for p in HERE.iterdir() if p.is_file() and p.name not in ('manifest.json','package-result.json')]+[p for folder in ('evidence','Vault') for p in (HERE/folder).rglob('*') if p.is_file()])
def main():
    result=read(E/'integration.json');cases=read(E/'acceptance.json');decisions=read(E/'decisions.json');calls=lines(E/'model-calls.jsonl');embeds=lines(E/'embedding-calls.jsonl')
    assert result['result']=='PASS' and result['answer_cases_passed']==result['answer_cases_total']==5 and len(result['scenarios'])==7
    assert all(result['cleanup']['volumes_removed']) and result['cleanup']['network_removed']
    assert all(all(c['checks'].values()) for c in cases) and len(calls)<=28 and all(c['exit_code']==0 and c['unexpected_tool_events']==0 for c in calls)
    assert not (E/'editorial-types.log').read_text(encoding='utf-8').strip()
    for d in decisions:assert hashlib.sha256(d['envelope']['record_json'].encode()).hexdigest()==d['envelope']['sha256']
    with (E/'acceptance.csv').open('w',encoding='utf-8',newline='') as f:
        writer=csv.writer(f);keys=list(cases[0]['checks']);writer.writerow(['case','expected_version','expected_days',*keys])
        for c in cases:writer.writerow([c['case'],c['expected_version'],c['expected_days'],*[c['checks'][k] for k in keys]])
    usage={k:sum(u.get(k,0) for c in calls for u in c['usage']) for k in ('input_tokens','cached_input_tokens','output_tokens','reasoning_output_tokens')}
    summary={'date':'2026-11-04','result':'PASS_SMALL_E2E','answer_cases':5,'contract_checkpoints':7,'pytest_console_seconds':214.39,'provider_calls':len(calls),
        'models':sorted({c['model'] for c in calls}),'observed_token_usage':usage,'monetary_cost':None,'advice_records':len(decisions),
        'embedding_vectors_computed':sum(e['batch'] for e in embeds),'truncated_embedding_inputs':sum(e['truncated_inputs'] for e in embeds),
        'production_approved':False,'python':sys.version,'history_operation':'read persisted record; no regeneration'}
    (E/'summary.json').write_text(json.dumps(summary,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    body=f'''# Resultados — 04/11/2026

**PASS neste recorte integrado; continuar a qualificação, sem aprovação geral de modelo, arquitetura ou produção.**

Um teste E2E passou em 214,39 s no console: sete checkpoints de contrato e cinco casos temporais de resposta. Fontes e perguntas sintéticas, três versões de uma política e uma fonte financeira. GPT-6.1 Terra, extração/keywords/resposta LightRAG nativas, embeddings ONNX reais, PostgreSQL/pgvector, Neo4j e Keycloak reais. Editorial TypeScript preservado; typecheck strict passou.

## Respostas observadas e suas fontes

'''
    for c in cases:body+=f"**{c['case']}** — versão esperada {c['expected_version']}, {c['expected_days']} dia(s). Todos os checks passaram.\n\n{c['answer']}\n\n"
    body+='''## Contratos comprovados no ensaio

- A fonte aprovada correta foi selecionada pelo corte de vigência/conhecimento e indexada em projeção isolada por snapshot/configuração. A recuperação nativa não misturou arquivos de versões distintas.
- A retificação mudou a nova resposta sobre fevereiro para um dia, preservando janeiro em dois e março em três. A resposta original de fevereiro, baseada no conhecimento anterior, permaneceu com dois dias e sua fonte v1.
- Leitura do registro e repetição idêntica do pedido retornaram exatamente o mesmo envelope/JSON/hash, sem nova chamada de modelo. Mesmo ID com outra entrada foi negado. Consulta de outro proprietário foi negada.
- Corte sem fonte publicada produziu abstenção antes do modelo. Fonte financeira foi realmente ingerida e respondeu ao autorizado; analista foi negado antes da inferência. Após revogação, o antigo autorizado perdeu acesso ao registro privado; governança com grant atual pôde auditá-lo.
- O papel SQL decision_writer recebeu permission denied para UPDATE e DELETE. O reinício preservou resposta original e revogação, sem inferência para ler o histórico.

São registros de **assessoramento de conhecimento**, não prova de execução de ações empresariais, aprovação de estratégia ou implementação do controlador adaptativo inteiro. A aplicação não permite que o caller escolha owner, workspace ou autoridade de publicação.

## Interpretação da pesquisa e do teste

RESEARCH.md registra os fundamentos consultados e os critérios. A distinção entre vigência, conhecimento e resposta histórica orientou o contrato. Retomar um grafo ou chamar um modelo de novo não foi tratado como leitura histórica.

O grader verifica valor principal, arquivo/citação esperados, presença da fonte nativa, isolamento de versões e ausência de canário. As cinco respostas foram inspecionadas no contexto esperado. Não houve NLI/avaliação completa de cada afirmação, reprodução ALCE ou estimativa estatística de acurácia. Citações com filename correto não são garantia geral de suporte.

O Terra ter passado aqui não desfaz a inconsistência observada no ensaio Graphiti: são tarefas e contextos diferentes. Esta rodada tampouco requalifica o histórico nativo de fatos do Graphiti; o contrato é seleção de fonte canônica e preservação do assessoramento original. Não houve comparação A/B de arquiteturas ou comprovação de superioridade geral.

## Persistência, acesso e limites

O registro inclui pergunta, datas solicitadas, snapshot/versão/hash da fonte, configuração/projeção, resposta e IDs de chamadas de provider. O texto JSON e seu hash são preservados no PostgreSQL. As permissões demonstradas são do papel de escrita; não são WORM ou proteção contra DBA/owner privilegiado capaz de alterar dados e hashes ou restaurar um backup antigo.

A camada canônica editorial ainda usa SQLite local nesta bancada; registros e índices usam PostgreSQL/Neo4j. Não houve backup conjunto, PITR, migração ou desastre de chaves do novo conjunto. O relógio/precisão do ledger de publicação não constitui uma transação bitemporal geral. A seleção assume marcos de substituição de uma fonte, não intervalos arbitrários, exclusões ou resolução de conflitos entre múltiplas fontes.

Publicação canônica e prontidão do índice são estados diferentes. Indexação lazy só libera consulta após processed/ready; projeções ou admissões interrompidas ficam bloqueadas para conciliação explícita. Essa recuperação de crash não foi ensaiada agora. O teste usa um processo/lock de aplicação, não qualifica múltiplos writers ou concorrência distribuída.

Identidades são contas de serviço sintéticas; sem homologação de SSO humano, TLS, cofre, MCP/gateway empresarial ou isolamento de clientes concorrentes. Obsidian segue opcional e sua UI não foi testada. Corpus representativo, custo financeiro, carga empresarial, equipes dinâmicas, Chief of Staff, Adaptive Controller e JARVIS completos permanecem necessários. LangGraph continua o único candidato a owner de workflow; não foi criado outro motor nem feito novo ensaio do workflow nesta rodada.

## Uso observado e decisão

'''+f'''{len(calls)} chamadas ao GPT-6.1 Terra, uso {json.dumps(usage)}. Dinheiro não medido: não há fatura/debito atribuível retornado pelo CLI. Embeddings: {summary['embedding_vectors_computed']} vetores calculados incluindo consultas/repetições, {summary['truncated_embedding_inputs']} entradas truncadas. Isso não mede custo mensal, TCO, escala ou custo por tarefa empresarial.

Não houve falha inesperada ou repetição para selecionar uma resposta melhor nesta execução. Os controles negativos foram recusados conforme esperado e estão preservados. Cleanup e inventário independente documentam remoção dos recursos próprios.

**Há evidência para avançar com este contrato de fonte e histórico no protótipo. Ainda não há base para aprovar modelo/arquitetura em geral ou produção.** O próximo ensaio deve ampliar corpus e casos independentes, comparar configurações de recuperação/modelos com os mesmos oráculos e testar recuperação/concor­rência do conjunto antes de aumentar autonomia.
'''
    (HERE/'RESULTS.md').write_text(body,encoding='utf-8')
    repos={}
    for name in ('lightrag','langgraph','graphiti-audit'):
        args=['git','-C',str(ROOT/'vendor'/name)];repos[name]={'sha':subprocess.check_output(args+['rev-parse','HEAD'],text=True).strip(),'clean':not subprocess.check_output(args+['status','--porcelain'],text=True).strip()}
    manifest={'date':'2026-11-04','result':'PASS_SMALL_E2E','production_approved':False,'source_repositories':repos,'images':result['images'],
        'files':{p.relative_to(HERE).as_posix():{'bytes':p.stat().st_size,'sha256':sha(p)} for p in files()},'excluded':['.state','virtual environments','weights','model-io','__pycache__','vendor']}
    mp=HERE/'manifest.json';mp.write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    out=ROOT/'fontes_decisoes_2026-11-04.zip'
    with zipfile.ZipFile(out,'w',zipfile.ZIP_DEFLATED) as z:
        for p in files()+[mp]:z.write(p,'canonical-decisions/'+p.relative_to(HERE).as_posix())
    with zipfile.ZipFile(out) as z:
        assert z.testzip() is None
        for name,meta in manifest['files'].items():assert hashlib.sha256(z.read('canonical-decisions/'+name)).hexdigest()==meta['sha256']
        patterns=[rb'eyJ[A-Za-z0-9_-]{12,}\.eyJ[A-Za-z0-9_-]{12,}\.[A-Za-z0-9_-]{12,}',rb'BEGIN (?:RSA |EC )?PRIVATE KEY',rb"PASSWORD '[a-f0-9]{48}'",rb'postgresql://[a-z_]+:[a-f0-9]{48}@']
        suspects=[n for n in z.namelist() if any(re.search(p,z.read(n)) for p in patterns)];assert not suspects,suspects
    info={'archive':out.name,'bytes':out.stat().st_size,'sha256':sha(out),'files':len(manifest['files'])+1,'crc_entry_hashes_and_credential_patterns_verified':True}
    (HERE/'package-result.json').write_text(json.dumps(info,indent=2)+'\n',encoding='utf-8');print(json.dumps(info,indent=2))

if __name__=='__main__':main()
