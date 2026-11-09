"""Consolidate observed native semantic evidence; package no backups, credentials or weights."""
import hashlib,json,re,subprocess,sys,zipfile
from pathlib import Path
HERE=Path(__file__).resolve().parent;ROOT=HERE.parents[1]
def read(name):return json.loads((HERE/'evidence'/name).read_text(encoding='utf-8'))
def lines(path):return [json.loads(x) for x in path.read_text(encoding='utf-8').splitlines() if x.startswith('{')]
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def files():return sorted([p for p in HERE.iterdir() if p.is_file() and p.name not in ('manifest.json','package-result.json')]+[p for p in (HERE/'evidence').rglob('*') if p.is_file()])

def main():
    result=read('integration.json');assert result['result']=='PASS'
    assert all(result['cleanup']['volumes_removed']) and result['cleanup']['network_removed']
    calls=lines(HERE/'evidence/model-calls.jsonl');embeds=lines(HERE/'evidence/embedding-calls.jsonl');answers=read('answers.json');graph=read('native-graph.json')
    assert len(result['scenarios'])==8 and len(answers)==5
    assert all(c['exit_code']==0 and c['unexpected_tool_events']==0 for c in calls) and len(calls)<=24
    assert all(c['dimension']==384 for c in embeds)
    previous=lines(HERE/'evidence/attempt-2/model-calls.jsonl')
    def usage(rows):return {k:sum(u.get(k,0) for c in rows for u in c['usage']) for k in ['input_tokens','cached_input_tokens','output_tokens','reasoning_output_tokens']}
    native={'result':'PASS_SMALL_NATIVE_INTEGRATION','successful_run_calls':len(calls),'successful_run_usage':usage(calls),
            'previous_failed_run_calls':len(previous),'all_observed_calls':len(calls)+len(previous),'all_observed_usage':usage(calls+previous),
            'monetary_cost':None,'embedding_batches':len(embeds),'embedding_vectors':sum(e['batch'] for e in embeds),
            'truncated_embedding_inputs':sum(e['truncated_inputs'] for e in embeds),'max_wordpiece_tokens':max(e['max_wordpiece_tokens'] for e in embeds),
            'checkpoints':len(result['scenarios']),'answer_cases':[a['case'] for a in answers],
            'production_approved':False,'python':sys.version}
    (HERE/'evidence/summary.json').write_text(json.dumps(native,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    text=f'''# Resultados — 04/11/2026

**PASS no recorte semântico nativo; continuar com LightRAG. Produção desta versão permanece NO-GO.**

Um teste E2E, oito checkpoints e cinco verificações de resposta passaram. Tempo até o fim das asserções: {result['elapsed_seconds']:.2f} s; duração pytest com cleanup em semantic.log. Quatro documentos sintéticos por geração, g1/g2; não se extrapola para capacidade empresarial.

O caminho testado usa extração/keywords/respostas GPT-6.1 Terra, chunker nativo, embeddings MiniLM ONNX reais, vetores PostgreSQL de 384 dimensões, KV/doc-status PostgreSQL e grafo Neo4j. Não há fixture de entidade/aresta/vetor/resposta nem monkeypatch do extrator nativo. A camada própria mantém identidade, grants, fonte canônica, geração, verificação de atualidade e publicação.

Grafo g1 observado: '''+', '.join(f"{p['domain']}: {len(p['nodes'])} nós / {len(p['edges'])} relações" for p in graph['partitions'])+f'''. O canário financeiro estava realmente recuperável por perfil autorizado e foi negado para o analista. Revogação posterior ao backup foi preservada após restore e nova ingestão g2. Consulta negada não fez nova chamada ao modelo.

O backup frio restaurou bancos, identidade, grafo e objetos em volumes vazios. A g1 antiga não abriu o gate diante do inventário g2. A reingestão nativa de g2 permitiu retomar consultas atuais; g1 permaneceu consultável explicitamente como histórico autorizado. Nenhuma ferramenta de envio real foi executada.

## Respostas efetivamente observadas

'''
    for item in answers:
        answer=item['response']['context'][0]['llm_response']['content']
        text+='**'+item['case']+'**\n\n'+answer+'\n\n'
    text+=f'''## Uso e limites

- Execução aprovada: {len(calls)} chamadas reais, uso {json.dumps(usage(calls),ensure_ascii=False)}.
- Tentativa anterior que falhou na inspeção SQL: {len(previous)} chamadas reais, preservadas separadamente. Total observado nesta rodada: {len(calls)+len(previous)} chamadas, uso {json.dumps(usage(calls+previous),ensure_ascii=False)}. O limite de 24 era por instalação; não foi apresentado como consumo total de todas as tentativas.
- Custo monetário não medido; não houve recibo de cobrança atribuível. Tokens incluem sobrecarga do CLI, extração, keywords e respostas. Não são uma projeção de custo de API empresarial.
- {len(embeds)} lotes, {native['embedding_vectors']} vetores calculados (incluindo consultas e entradas repetidas), {native['truncated_embedding_inputs']} entradas truncadas, maior entrada {native['max_wordpiece_tokens']} WordPiece tokens. Esses vetores calculados não significam esse mesmo número de registros únicos no banco.
- Sem eventos inesperados de ferramentas no Codex. Isso não certifica prompt injection geral ou o gateway MCP do produto.
- Este PASS fecha a ausência de prova integrada com extração/embeddings reais neste corpus pequeno. Não fecha recall/citações em corpus representativo, temporalidade Graphiti, conectores reais, TLS/federação/cofre, custo monetário, carga empresarial, PITR/failover ou implementação completa da organização adaptativa/JARVIS.

## Falhas preservadas

attempt-1: erro de prontidão PostgreSQL, antes do modelo; corrigida a espera pelo listener TCP definitivo. attempt-2: erro da consulta auxiliar de inspeção por capitalização de identificador PostgreSQL; corrigida a fixture. Não se alterou o código LightRAG para fazer o teste passar. Logs de diagnóstico redigidos para retirar senha efêmera da própria fixture; backups e chaves excluídos do pacote. A tentativa final inteira passou, em vez de somar testes incompletos como aprovação.

Os critérios e limites estão em REPORT.md; comandos em COMMANDS.md. A decisão anterior de continuar componentes permanece, agora com evidência semântica integrada mais forte. O próximo bloqueio de conhecimento é qualificar corpus representativo e temporalidade/contradições, preservando a API e um único dono de execução.
'''
    (HERE/'RESULTS.md').write_text(text,encoding='utf-8')
    repos={}
    for name in ['lightrag','langgraph','graphiti-audit']:
        args=['git','-C',str(ROOT/'vendor'/name)]
        repos[name]={'sha':subprocess.check_output(args+['rev-parse','HEAD'],text=True).strip(),'working_tree_clean':not subprocess.check_output(args+['status','--porcelain'],text=True).strip()}
    manifest={'date':'2026-11-04','decision':'CONTINUE_LIGHTRAG_NATIVE_PATH_SMALL_PILOT','production_approved':False,'result':result['result'],'source_repositories':repos,'images':result['images'],
              'embedding_revision':result['embedding_revision'],'model':'gpt-6.1-terra','files':{p.relative_to(HERE).as_posix():{'bytes':p.stat().st_size,'sha256':sha(p)} for p in files()},
              'excluded':['.state (private backups/keys)','.models','virtual environments','model-io','__pycache__','vendor']}
    mp=HERE/'manifest.json';mp.write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    archive=ROOT/'integracao_semantica_2026-11-04.zip'
    with zipfile.ZipFile(archive,'w',zipfile.ZIP_DEFLATED) as z:
        for p in files()+[mp]:z.write(p,'semantic-integration/'+p.relative_to(HERE).as_posix())
    with zipfile.ZipFile(archive) as z:
        assert z.testzip() is None
        for name,meta in manifest['files'].items():assert hashlib.sha256(z.read('semantic-integration/'+name)).hexdigest()==meta['sha256']
        patterns=[rb'eyJ[A-Za-z0-9_-]{12,}\.eyJ[A-Za-z0-9_-]{12,}\.[A-Za-z0-9_-]{12,}',rb'BEGIN (?:RSA |EC )?PRIVATE KEY',rb"PASSWORD '[a-f0-9]{48}'",rb'postgresql://[a-z_]+:[a-f0-9]{48}@']
        suspects=[name for name in z.namelist() if any(re.search(p,z.read(name)) for p in patterns)]
        assert not suspects,suspects
    summary={'archive':archive.name,'bytes':archive.stat().st_size,'sha256':sha(archive),'files':len(manifest['files'])+1,'entry_hashes_crc_and_credential_patterns_verified':True}
    (HERE/'package-result.json').write_text(json.dumps(summary,indent=2)+'\n',encoding='utf-8');print(json.dumps(summary,indent=2))

if __name__=='__main__':main()
