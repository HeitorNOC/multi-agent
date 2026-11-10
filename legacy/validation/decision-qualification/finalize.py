"""Consolidate observed evidence and package only explicit, non-private deliverables."""
import hashlib,json,subprocess,zipfile
from pathlib import Path
HERE=Path(__file__).resolve().parent;ROOT=HERE.parents[1]

def read(name):return json.loads((HERE/'evidence'/name).read_text(encoding='utf-8'))
def sha(path):return hashlib.sha256(path.read_bytes()).hexdigest()
def selected():
    return sorted([p for p in HERE.iterdir() if p.is_file() and p.name not in ('manifest.json','package-result.json')]+
                  [p for name in ('evidence','corpus') for p in (HERE/name).rglob('*') if p.is_file()])
def main():
    integration=read('integration.json');model=read('model-evaluation.json');embedding=read('pretrained-embedding.json');sandbox=read('sandbox-gateway.json')
    assert integration['result']=='PASS' and integration.get('human_oidc')
    assert model['result']=='PASS_SMALL' and embedding['result']=='PASS_SMALL' and sandbox['result']=='PASS'
    captured=read('model-input-context.json')
    assert hashlib.sha256(json.dumps(captured,ensure_ascii=False).encode()).hexdigest()==model['context_sha256']
    events=[]
    for p in [HERE/'evidence/codex-probe.jsonl',HERE/'evidence/model-eval.jsonl']:
        for line in p.read_text(encoding='utf-8-sig').splitlines():
            try:e=json.loads(line)
            except ValueError:continue
            if e.get('type')=='turn.completed':events.append(e['usage'])
    total={key:sum(e.get(key,0) for e in events) for key in ['input_tokens','cached_input_tokens','output_tokens','reasoning_output_tokens']}
    (HERE/'evidence/measured-model-usage.json').write_text(json.dumps({'calls':len(events),'usage':total,'monetary_cost':None,'scope':'probe plus one seven-case benchmark; excludes the coordinating chat and all other system usage'},indent=2)+'\n',encoding='utf-8')
    load=integration['small_load'];admission=next(x for x in integration['scenarios'] if x['name']=='concurrent_budget_admission_does_not_oversubscribe')
    results=f'''# Resultados observados — 04/11/2026

Decisão: continuar a arquitetura por componentes e o piloto restrito; **NO-GO para produção desta versão**. Fundamentação completa em DECISION.md.

- Integração final: um teste E2E PASS, {len(integration['scenarios'])} checkpoints, {integration['elapsed_seconds']:.2f} s até o fim das asserções; duração pytest incluindo cleanup em decision.log. Serviços reais, extração/vetores sintéticos.
- Recuperação: g1 coerente recusada por inventário atual g2; seis respostas inválidas/indisponíveis negadas; g2 republicada; revogação mantida; mudança posterior de sequência fecha gate. Inventário externo é simulador, não ERP real.
- Efeitos: {integration['external_sends']} envios e {integration['external_receipts']} recibos no provedor simulado, correspondentes à ação histórica já executada e à nova decisão g2. Ausência de recibo histórico não provoca send. Aprovação antiga não habilita execução.
- Login humano sintético: authorization code + PKCE S256, state e nonce, JWT assinado, proibição de escalada, replay de code/PKCE incorreto recusados e revogação no cadastro da aplicação. Sem federação real, MFA ou TLS; cookie policy permissiva somente no loopback HTTP da fixture.
- Carga: {load['requests']} consultas, concorrência {load['concurrency']}, erros {load['errors']}, p50 {load['p50_seconds']:.4f} s, p95 {load['p95_seconds']:.4f} s. Há cache, corpus minúsculo e nenhum LLM no caminho medido. Não usar como previsão empresarial.
- Admissão concorrente: {admission['attempts']} tentativas, {admission['admitted']} admitidas, gasto sintético {admission['spent']}, reserva {admission['held']}, limite {admission['limit']}; sem ultrapassar saldo. Não mede dinheiro nem fairness/filas distribuídas.
- Modelo real: GPT-6.1 Terra, {model['passed']}/{model['total']} casos no mesmo lote, {model['seconds']:.2f} s de CLI. Respostas revisadas quanto a política atual/histórica, 20%, causalidade hipotética, abstenção e instrução hostil. Nenhum evento de ferramenta. Índice de origem ainda usa fixtures de extração/embedding.
- Uso real observado no probe + benchmark: {total['input_tokens']} tokens de entrada, {total['cached_input_tokens']} em cache, {total['output_tokens']} de saída. Custo monetário **não medido**: CLI não retornou fatura ou débito atribuível. A sobrecarga de instruções do CLI está incluída; não é contagem isolada do prompt empresarial.
- Embeddings reais locais: {embedding['top1']}/{embedding['queries']} top1 e {embedding['top3']}/{embedding['queries']} top3, {embedding['documents']} documentos, {embedding['dimensions']} dimensões. Benchmark denso isolado com MiniLM ONNX quantizado; revisão e hashes fixados. Não substitui a prova integrada semântica LightRAG/Graphiti.
- Executor isolado: quatro capabilities inválidas/repetidas recusadas; sem credenciais, egress e escrita privilegiada; cancelamento com filho; dois contêineres próprios removidos. Perfil de componente, não implantação de gateway MCP.
- Avisos Python: 91 entradas, uma não auditável (LightRAG 1.5.8 indisponível no catálogo), sem avisos conhecidos nas demais. Não é auditoria de segurança completa.

## Falhas preservadas

`attempt-1`: PASS sem os ensaios humanos posteriores, 272,92 s. `attempt-2`: FAIL em 302,90 s na fixture de login humano; Keycloak registrou cookie_not_found no HTTP loopback. Adaptação explícita da política de cookies do cliente de teste, sem alegar conformidade HTTPS. A tentativa final precisa passar integralmente; não se soma PASS antigo com FAIL novo para produzir aprovação. A primeira invocação pip-audit usou flags incompatíveis, foi preservada e corrigida. O worker com exit 1 por perda de ACK do provedor é falha deliberadamente injetada, exigida pelo teste.

Durante a preparação foram acrescentados captura imutável do contexto do benchmark e tratamento de timeout do inventário. A captura usada pelo modelo fica em model-input-context.json e seu hash foi conferido; a consulta da última instalação fica em model-context.json. Não houve novas chamadas ao modelo para adaptar respostas ao gabarito.

## Limites operacionais

A recuperação depende de inventário confiável, diário externo, provedor e chaves retidas pelo operador. Backups são frios; nenhuma medição de RTO/RPO/PITR/failover. A verificação HTTP assinada não demonstra autenticidade/completude dos conectores reais nem elimina janela distribuída entre verificação e efeito. Sandbox usa rede none; DB/grafo/IdP usam bridge com localhost, sem qualificação de egress desses serviços. Nenhuma mensagem ou transação empresarial real foi executada.
'''
    (HERE/'RESULTS.md').write_text(results,encoding='utf-8')
    repos={}
    for name in ['langgraph','lightrag','graphiti-audit','paperclip','agentscope-audit','openagents-audit']:
        args=['git','-C',str(ROOT/'vendor'/name)]
        repos[name]={'sha':subprocess.check_output(args+['rev-parse','HEAD'],text=True).strip(),'working_tree_clean':not subprocess.check_output(args+['status','--porcelain'],text=True).strip()}
    manifest={'date':'2026-11-04','production':'NO_GO_THIS_BUILD','architecture':'CONTINUE_COMPONENT_APPROACH','integration_result':integration['result'],'model_result':model['result'],'embedding_result':embedding['result'],'sandbox_result':sandbox['result'],'source_repositories':repos,'images':integration['images'],
              'files':{p.relative_to(HERE).as_posix():{'bytes':p.stat().st_size,'sha256':sha(p)} for p in selected()},'excluded':['.state (private backups/keys)','.models (weights/cache)','.embedding-venv','.security-venv','.venv','model-io','__pycache__','vendor']}
    mp=HERE/'manifest.json';mp.write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    out=ROOT/'decisao_arquitetura_2026-11-04.zip'
    with zipfile.ZipFile(out,'w',zipfile.ZIP_DEFLATED) as z:
        for p in selected()+[mp]:z.write(p,'decision-qualification/'+p.relative_to(HERE).as_posix())
    with zipfile.ZipFile(out) as z:
        assert z.testzip() is None
        for name,meta in manifest['files'].items():assert hashlib.sha256(z.read('decision-qualification/'+name)).hexdigest()==meta['sha256']
    summary={'archive':out.name,'bytes':out.stat().st_size,'sha256':sha(out),'files':len(manifest['files'])+1,'entry_hashes_and_crc_verified':True}
    (HERE/'package-result.json').write_text(json.dumps(summary,indent=2)+'\n',encoding='utf-8');print(json.dumps(summary,indent=2))

if __name__=='__main__':main()
