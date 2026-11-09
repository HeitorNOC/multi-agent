"""Package positive and negative evidence without converting acceptance failures into approval."""
import csv,hashlib,json,re,subprocess,sys,zipfile
import xml.etree.ElementTree as ET
from pathlib import Path
HERE=Path(__file__).resolve().parent;ROOT=HERE.parents[1];E=HERE/'evidence'
def read(p):return json.loads(p.read_text(encoding='utf-8'))
def rows(p):return [json.loads(s) for s in p.read_text(encoding='utf-8').splitlines() if s.startswith('{')]
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def selected():return sorted([p for p in HERE.iterdir() if p.is_file() and p.name not in ('manifest.json','package-result.json')]+[p for folder in ('evidence','Vault') for p in (HERE/folder).rglob('*') if p.is_file()])
def suite(p):
    r=ET.parse(p).getroot();s=r if r.tag=='testsuite' else r.find('testsuite');return dict(s.attrib)
def main():
    t=read(E/'terra/integration.json');s=read(E/'sol/integration.json');publication=read(E/'integration.json')
    assert t['execution_completed'] and s['execution_completed'] and publication['result']=='PASS'
    assert all(publication['cleanup']['volumes_removed']) and publication['cleanup']['network_removed']
    unit=(E/'editorial-tests.log').read_text(encoding='utf-8');assert re.search(r'pass 10\b',unit) and re.search(r'fail 0\b',unit)
    assert not (E/'editorial-types.log').read_text(encoding='utf-8').strip()
    terra=read(E/'terra/temporal-checks.json');sol=read(E/'sol/temporal-checks.json')
    with (E/'temporal-comparison.csv').open('w',encoding='utf-8',newline='') as f:
        w=csv.writer(f);w.writerow(['criterion','expected','terra_observed','terra_pass','sol_observed','sol_pass'])
        for a,b in zip(terra,sol,strict=True):
            assert a['name']==b['name'] and a['expected_days']==b['expected_days']
            w.writerow([a['name'],a['expected_days'],a['observed_days'],a['pass'],b['observed_days'],b['pass']])
    measured={};allcalls=[];embeds=[]
    for name,folder in [('terra',E/'terra'),('sol',E/'sol'),('publication',E)]:
        calls=rows(folder/'model-calls.jsonl');allcalls+=calls;embeds+=rows(folder/'embedding-calls.jsonl')
        assert all(c['exit_code']==0 and c['unexpected_tool_events']==0 for c in calls)
        measured[name]={'calls':len(calls),'models':sorted({c['model'] for c in calls}),'usage':{k:sum(u.get(k,0) for c in calls for u in c['usage']) for k in ('input_tokens','cached_input_tokens','output_tokens','reasoning_output_tokens')}}
    summary={'date':'2026-11-04','editorial_tests':10,'editorial_typecheck':'PASS_STRICT','native_temporal_terra':{'passed':t['temporal_passed'],'total':t['temporal_total'],'pytest':suite(E/'terra/temporal.xml')},
        'native_temporal_sol':{'passed':s['temporal_passed'],'total':s['temporal_total'],'pytest':suite(E/'sol/temporal.xml')},
        'publication_failure_window':{'result':publication['result'],'pytest':suite(E/'publication.xml')},'model_usage':measured,'total_calls':len(allcalls),
        'monetary_cost':None,'embedding_vectors_calculated':sum(x['batch'] for x in embeds),'truncated_embedding_inputs':sum(x['truncated_inputs'] for x in embeds),
        'production_approved':False,'obsidian_ui_tested':False,'python':sys.version}
    (E/'summary.json').write_text(json.dumps(summary,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    body=f'''# Resultados — 04/11/2026

**Avançou o protótipo editorial e de publicação. A aceitação temporal completa do Graphiti falhou; produção não aprovada.**

| Ensaio | Resultado observado |
|---|---|
| Editorial TypeScript | 10 testes PASS, typecheck strict PASS |
| Graphiti + GPT-6.1 Terra | {t['temporal_passed']}/{t['temporal_total']} critérios, pytest FAIL em {float(summary['native_temporal_terra']['pytest']['time']):.2f} s |
| Graphiti + GPT-6.1 Sol | {s['temporal_passed']}/{s['temporal_total']} critérios, pytest FAIL em {float(summary['native_temporal_sol']['pytest']['time']):.2f} s |
| Falha entre grafo e commit editorial | E2E PASS em {float(summary['publication_failure_window']['pytest']['time']):.2f} s, reinício e conciliação sem reingestão |
| Obsidian | Vault compatível entregue; aplicativo não encontrado nos dois caminhos verificados; UI não testada |

Os tempos da tabela vêm do testsuite XML; o console inclui um pequeno overhead adicional de pytest.

## Evidência temporal

'''
    for a,b in zip(terra,sol):body+=f"- {a['name']}: esperado {a['expected_days']}; Terra {a['observed_days']} ({'PASS' if a['pass'] else 'FAIL'}); Sol {b['observed_days']} ({'PASS' if b['pass'] else 'FAIL'}).\n"
    body+='''
Terra gerou uma relação textual de dois dias com atributo dias_remotos=3; a mesma aresta apareceu em três verificações. Sol corrigiu essa inconsistência neste corpus. Nos dois modelos, a consulta de fevereiro no instante de conhecimento anterior à retificação retornou vazia. Os dados brutos, prompts e registros nativos foram preservados; não houve reparo manual de arestas/datas ou mudança do critério.

O diagnóstico somente lê os registros capturados. Depois da correção, os limites invalid_at atuais não recuperam a fronteira antiga. Remover apenas o predicado expired_at ainda não produz os registros esperados para esse corte. Esse é um limite do contrato/configuração testados; não prova impossibilidade universal de Graphiti. Não apresentamos os seis PASS de Sol como aprovação dos sete requisitos.

## Editorial e fonte canônica

O backend autenticado recebe propostas Markdown, exige revisor distinto e hash exato, rejeita mudança de classificação e sobrescrita de versão, publica snapshot imutável e concilia replay de publicação concluída sem novas chamadas ao modelo. Identidades são contas sintéticas de serviço no Keycloak, não um fluxo humano editorial com MFA/federação qualificado.

O módulo TypeScript consegue selecionar a versão da **fonte** por vigência e instante de publicação, inclusive antes/depois de retificação; são testes de componente, não recomputação de fatos Graphiti. A API de fonte canônica foi exercitada no E2E adicional com uma fonte: snapshot original após edição não aprovada, e ausência antes de sua publicação. O caso de três versões é testado no componente, sem inferir que toda a integração multiversão foi homologada.

A falha injetada deixou o grafo gravado em graph_ready e consultas 503. O restart manteve o bloqueio. A conciliação usou o snapshot aprovado original apesar de o arquivo ter sido alterado, não fez novas chamadas ao modelo e manteve uma identidade de publicação/episódio. O ramo em que a própria ingestão Graphiti tem resultado incerto continua bloqueado para conciliação específica; não se afirmou exactly-once nativo.

## Falhas e adaptações

- Inicialização duplicada de índices e limite de processos da fixture: corrigidos antes dos ensaios de aceitação; pids 128→256, memória 1 GB/CPU 1 mantidos. Primeira falha preservada em attempt-1, sem modelo invocado.
- Dependências httpx/asyncpg: instalação explícita via cache offline após diagnóstico e falha DNS registrada. Sem alteração de upstream.
- Typecheck inicialmente CommonJS: package.json passou a declarar ES module, acompanhando o runtime Node.
- Comparação lexicográfica de datas no componente canônico: teste de fração de segundo mostrou erro; corrigido com comparação temporal SQLite, regressão red/green preservada.
- Ensaios nativos Terra e Sol continuaram FAIL quando um requisito falhou. A prova adicional positiva não apaga essas reprovações.

## Consumo e operação

'''
    for name,v in measured.items():body+=f"- {name}: {v['calls']} chamadas, modelos {v['models']}, uso {json.dumps(v['usage'])}.\n"
    body+=f'''
Total observado: {len(allcalls)} chamadas. Sem fatura ou custo monetário atribuível retornado; não se convertem tokens em cobrança medida. Os prompts do CLI incluem sobrecarga de instruções. Embeddings locais: {summary['embedding_vectors_calculated']} vetores calculados e {summary['truncated_embedding_inputs']} entradas truncadas, incluindo consultas/repetições; não é contagem de registros únicos.

Serviços e dados são reais no recorte de infraestrutura, mas todo conteúdo é sintético. Telemetria Graphiti desabilitada. Instalações descartáveis por prefixo próprio, com registros de cleanup. Nenhum deployment de produção, mensagem real, compra de serviço ou dado empresarial confidencial.

## Limites que permanecem

Não houve qualificação de UI Obsidian, sincronização, Markdown/YAML arbitrário, corpus representativo, coabitação LightRAG+Graphiti, backup conjunto do novo ledger SQLite/PG/grafo, múltiplos writers, ingestão incerta, SSO humano/TLS/cofre, cobrança financeira, carga empresarial ou PITR/failover. O ledger SQLite é uma bancada; a camada de produto deverá consolidar persistência/relógio/outbox no desenho PostgreSQL da instalação. A seleção canônica assume marcos de vigência que substituem a regra anterior dessa fonte; não prova intervalos arbitrários, exclusões e contradições entre várias fontes.

A decisão detalhada está em DECISION.md. A arquitetura principal permanece; Graphiti é candidato a projeção de apoio e não a autoridade exclusiva da história de conhecimento. O próximo passo é integrar seleção da fonte canônica ao LightRAG e preservar snapshots das decisões, antes de ampliar autonomia.
'''
    (HERE/'RESULTS.md').write_text(body,encoding='utf-8')
    repos={}
    for name in ('graphiti-audit','lightrag','langgraph'):
        args=['git','-C',str(ROOT/'vendor'/name)]
        repos[name]={'sha':subprocess.check_output(args+['rev-parse','HEAD'],text=True).strip(),'working_tree_clean':not subprocess.check_output(args+['status','--porcelain'],text=True).strip()}
    manifest={'date':'2026-11-04','production_approved':False,'native_temporal_terra':t['result'],'native_temporal_sol':s['result'],'editorial_tests':'PASS_10',
        'publication_failure_window':publication['result'],'source_repositories':repos,'images':publication['images'],
        'files':{p.relative_to(HERE).as_posix():{'bytes':p.stat().st_size,'sha256':sha(p)} for p in selected()},'excluded':['.state','.venv','weights','model-io','vendor','__pycache__']}
    mp=HERE/'manifest.json';mp.write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    archive=ROOT/'temporal_editorial_2026-11-04.zip'
    with zipfile.ZipFile(archive,'w',zipfile.ZIP_DEFLATED) as z:
        for p in selected()+[mp]:z.write(p,'temporal-editorial/'+p.relative_to(HERE).as_posix())
    with zipfile.ZipFile(archive) as z:
        assert z.testzip() is None
        for name,meta in manifest['files'].items():assert hashlib.sha256(z.read('temporal-editorial/'+name)).hexdigest()==meta['sha256']
        patterns=[rb'eyJ[A-Za-z0-9_-]{12,}\.eyJ[A-Za-z0-9_-]{12,}\.[A-Za-z0-9_-]{12,}',rb'BEGIN (?:RSA |EC )?PRIVATE KEY',rb"PASSWORD '[a-f0-9]{48}'",rb'postgresql://[a-z_]+:[a-f0-9]{48}@']
        suspects=[name for name in z.namelist() if any(re.search(p,z.read(name)) for p in patterns)];assert not suspects,suspects
    summary={'archive':archive.name,'bytes':archive.stat().st_size,'sha256':sha(archive),'files':len(manifest['files'])+1,'crc_entry_hashes_and_credential_patterns_verified':True}
    (HERE/'package-result.json').write_text(json.dumps(summary,indent=2)+'\n',encoding='utf-8');print(json.dumps(summary,indent=2))

if __name__=='__main__':main()
