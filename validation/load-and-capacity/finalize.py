import hashlib,json,subprocess,zipfile
from pathlib import Path
from freshness import verify
P=Path(__file__).parent;R=P.parents[1];E=P/'evidence';Q=P.parent/'load-quota-verification'
def read(p):return json.loads(p.read_text(encoding='utf-8'))
def digest(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def lines(p):return [json.loads(x) for x in p.read_text(encoding='utf-8').splitlines() if x.startswith('{')]
def main():
    result=read(E/'integration.json');qr=read(Q/'evidence/integration.json');cases=read(E/'acceptance.json');blocks=read(E/'load-blocks.json');calls=lines(E/'model-calls.jsonl')
    initial=read(E/'attempt-setup/reservation-check.json');fillers=read(E/'unused-reservations.json')
    proof_count=0;unverified=[]
    for root,r in [(E,result),(Q/'evidence',qr)]:
        for p in lines(root/'freshness-requests.jsonl'):
            if p['proof']['payload']['installation']!=r['installation']:
                unverified.append({'installation':p['proof']['payload']['installation'],'reason':'cancelled setup installation; public key not captured; raw proof preserved, not counted as verified'})
                continue
            verify(p['proof'],r['freshness_authority']['public_key'],r['installation'],p['request']['nonce'],now=p['request']['issued']);proof_count+=1
    assert not list((Q/'evidence').glob('llm-*.jsonl'))
    same=['application.py','read_profile.py','controls.py','coordination.py','codex_provider.py','freshness.py','freshness_authority.py','editorial.ts','provenance.ts','registry.json','schema.sql']
    assert all(digest(P/f)==digest(Q/f) for f in same)
    assert len(calls)+len(fillers)==40 and len({x['call'] for x in calls})==len(calls)
    assert set(x['call'] for x in calls).isdisjoint(x['number'] for x in fillers)
    usage={k:sum(u.get(k,0) for c in calls for u in c['usage']) for k in ['input_tokens','cached_input_tokens','output_tokens','reasoning_output_tokens']}
    byphase={b['phase']:b for b in blocks};base=byphase['baseline-under-inference'];parallel=byphase['parallel-under-inference']
    server=[]
    for f in E.glob('http-*.jsonl'):server+=lines(f)
    queues={}
    for b in blocks:
        values=sorted(x['queue_seconds'] for x in server if x['phase']==b['phase'])
        queues[b['phase']]={'samples':len(values),'p95_seconds':values[max(0,__import__('math').ceil(.95*len(values))-1)] if values else None}
    (E/'queue-summary.json').write_text(json.dumps(queues,indent=2),encoding='utf-8')
    summary={'main_original_result':result['result'],'main_failure':'test expected quota 429 for an already closed fingerprint; actual 409 is correct',
        'quota_fixture_result':qr['result'],'full_main_e2e_after_test_input_fix':'NOT_RUN','native_cases_passed':sum(all(c['checks'].values()) for c in cases),'native_cases_total':len(cases),
        'main_completed_cli_calls':len(calls),'main_reservations_without_cli':len(fillers),'cancelled_setup_reserved_execution_or_usage_unknown':initial['model_reservations'],
        'quota_fixture_cli_calls':0,'quota_fixture_reservations_without_cli':40,'usage_observed_completed_calls_only':usage,
        'baseline_pressure_p95_seconds':base['p95_seconds'],'parallel_pressure_p95_seconds':parallel['p95_seconds'],
        'exploratory_p95_limit_seconds':1,'slo_failures':[b['phase'] for b in blocks if not b['slo_passed']],
        'proofs_verified':proof_count,'cancelled_setup_proofs_not_verified':len(unverified),'backend_identical_in_quota_fixture':True,'production':'NO_GO','model_tool_events':sum(c['unexpected_tool_events'] for c in calls)}
    (E/'proof-audit.json').write_text(json.dumps({'verified':proof_count,'unverified_cancelled_setup':unverified},indent=2),encoding='utf-8')
    (E/'summary.json').write_text(json.dumps(summary,ensure_ascii=False,indent=2),encoding='utf-8')
    text=f'''# Corpus, fila e exaustão — 04/11/2026

**Produção continua NO-GO.** O ensaio mediu um gargalo da camada própria e demonstrou melhora no perfil experimental de leitura. O E2E original terminou **{result['result']}** na última expectativa do teste (409 correto para fingerprint encerrado, quando se esperava 429). A verificação complementar de quota terminou **{qr['result']}**, com zero modelo. Não houve repetição integral após corrigir a entrada do roteiro; source original, falha e JUnit preservados.

## Medidas de leitura de histórico

Limite exploratório predefinido: p95 <= 1 s. Não é SLO de uma empresa grande. Tokens de serviço foram emitidos antes da cronometragem; JWT/DB/HTTP/provas estão no tempo medido. Cliente urllib sem pooling, métricas e logging da bancada ativos; throughput é desta amostra, não teto de produção.

| Perfil / cenário | N | Concorrência | p50 s | p95 s | Máx s | Erros | req/s da amostra | Critério |
|---|---:|---:|---:|---:|---:|---:|---:|---|
'''
    for b in blocks:text+=f"| {b['phase']} | {b['count']} | {b['concurrency']} | {b['p50_seconds']:.3f} | {b['p95_seconds']:.3f} | {b['max_seconds']:.3f} | {b['errors']} | {b['requests_per_second']:.1f} | {'PASS' if b['slo_passed'] else 'FAIL'} |\n"
    text+=f'''
Durante uma inferência real, as oito leituras no perfil original aguardaram a trava de negócio: p95 {base['p95_seconds']:.3f} s, acima do limite. No perfil experimental, p95 {parallel['p95_seconds']:.3f} s; houve duas chamadas CLI reais na janela de cada perfil. Não se usou uma resposta de modelo em cache para simular trabalho ativo. Com N=8, p95 nearest-rank coincide com o máximo observado: é uma rajada pequena, não estimativa estável de cauda empresarial. A ordem foi fixa e as duas perguntas são diferentes; não é comparação de velocidade entre modelos.

O ajuste deixa decisões antigas imutáveis serem lidas enquanto há writer ativo, mantendo grants atuais e gates antes/depois. Sem writer, usa shared lock e confere o head. Foram exercitados freeze, revogação do próprio usuário financeiro e crash deixando intenção sem writer: leituras foram negadas corretamente. Não houve restore frio completo depois desse perfil nem prova de todas as corridas de grant/sessão PG/rede. O ajuste melhora somente histórico; novas tarefas de IA continuam serializadas por instalação. queue-summary.json contém a instrumentação do servidor; o campo do perfil experimental inclui estabelecimento de conexão/shared-try e não é perfeitamente idêntico ao tempo de contenção do perfil original.

## Corpus e respostas

Três manuais sintéticos aprovados, com fontes públicas conflitantes e uma financeira restrita, seis perguntas por modo; {summary['native_cases_passed']}/{len(cases)} passaram no grader lexical/fonte/citação/canário. Não é corpus representativo de milhões de documentos nem consulta federada de fontes. Native LightRAG, extração e ONNX reais; nenhuma aresta/resposta foi injetada.

| Caso | Modo | Chamadas CLI na solicitação | Tempo s | Checks |
|---|---|---:|---:|---|
'''
    for c in cases:text+=f"| {c['case']} | {c['mode']} | {c['model_calls']} | {c['seconds']:.2f} | {'PASS' if all(c['checks'].values()) else 'FAIL'} |\n"
    text+='''
Primeira consulta mix de cada fonte inclui ingestão; naive usa índice já pronto. Não inferir preço/performance total de ingestão desses tempos. As fontes/snapshots são os mesmos nos dois modos; perguntas/ordem fixas, sem reruns para obter acerto. O grader é limitado a valores/abstenção, arquivo/citação e isolamento; não avalia suporte de cada afirmação ou significância estatística. Respostas completas em acceptance.json e decisões originais em decisions.json.

## Quota cheia e a falha do roteiro

Com 40 reservas preenchidas, uma nova pergunta em fonte já ingerida percorreu o caminho nativo. O provider recusou reservar; nenhuma nova CLI foi iniciada. A API devolveu 409 por falha de geração e deixou intenção/admission pendente; a leitura seguinte de histórico foi bloqueada com 503. Isso é falha real de disponibilidade do perfil original, preservada em quota-baseline.json.

O preflight experimental verifica quota antes da intenção/admission. O último passo do E2E, porém, trocou só UUID e repetiu a pergunta da intenção encerrada unknown; o tombstone retornou corretamente 409 antes do preflight. A proteção não foi removida ou reordenada para forçar PASS. O roteiro futuro agora usa pergunta realmente nova; não se repetiram as inferências.

Uma instalação complementar usa exatamente os mesmos arquivos de backend (hashes conferidos), cria pela API uma resposta de abstenção anterior à vigência, fecha uma intenção e enche a quota sem modelos. Resultado: entrada nova recusada 429 antes de admission, fingerprint encerrado recusado 409, seq da autoridade inalterado e 16 leituras exatas de histórico nas duas APIs, sem gate indevido. É regressão de infraestrutura com histórico de abstenção, não repetição do benchmark com índice nativo/corpus/modelos. Evidências e código complementares estão no pacote.

O preflight não assegura budget suficiente para todos os passos: exaustão no meio da ingestão, keywords ou geração ainda pode deixar resultado pendente. Também é conservador e recusa novos pedidos sem vaga mesmo que acabassem em cache/abstenção. Falta reserva por job, rastreio de chamadas por trabalho e política de falha parcial antes de concorrência real de várias tarefas.
'''
    text+=f'''
## Uso, custo e tentativa inicial

Foram {len(calls)} saídas CLI Terra concluídas, com tokens observados {json.dumps(usage,ensure_ascii=False)} e {summary['model_tool_events']} eventos de ferramentas. A sobra de {len(fillers)} vagas foi consumida por reservas locais sem CLI no ensaio principal. Na regressão complementar, 40 reservas locais e zero CLI. Essas reservas não são chamadas a modelos nem dinheiro gasto.

A tentativa inicial cancelada tinha {initial['model_reservations']} reserva já feita e nenhum stdout/usage concluído capturado. Execução e consumo dessa tentativa permanecem desconhecidos. A afirmação inicial de que nenhuma chamada teria ocorrido foi corrigida; zero arquivos não prova custo zero. A reserva/checkpoint antigo é auditado em attempt-setup/reservation-check.json. O uso dessa tentativa não foi inventado ou incorporado à soma de tokens conhecidos. Há no máximo uma tentativa de CLI por reserva nessa implementação, mas não há evidência de sua conclusão.

Provas verificadas offline para as duas instalações com chave pública capturada: {proof_count}. Provas iniciais da instalação cancelada, cuja chave pública não foi exportada: {len(unverified)}, preservadas sem alegação de verificação criptográfica. O primeiro consolidador tentou usar a chave da instalação nova e recusou corretamente a assinatura; a análise agora particiona por instalação e registra essa lacuna, sem alterar provas ou inventar uma chave.

**Custo monetário atribuível permanece não medido.** Não converter contagem de CLI/reserva em dinheiro. Latência/usage incluem transporte Codex e seu contexto; não equivalem à API de inferência direta, outra hospedagem ou custo completo de uma empresa. Amostras Docker cobrem apenas containers, sem custo/recursos da API e embeddings no host, modelo remoto ou backup.

## Decisão técnica

Continuar qualificação dos componentes e da camada própria. O teste não justifica descartar LightRAG/LangGraph: a espera de histórico foi provocada pela nossa exclusão global, e o perfil experimental mostrou caminho de melhoria. Isso também não aprova os motores universalmente. Produção segue NO-GO por concorrência de tarefas ainda serializada, quota parcial sem tratamento, ausência de custo financeiro atribuível, corpus/carga pequenos, falta de restore integrado do perfil novo e produto empresarial incompleto.

Priorizar camada empresarial TypeScript + único owner LangGraph, orçamento/fencing por trabalho e testes combinados de recuperação antes de aumentar carga/modelo. Preservar cérebro lógico central, instalação dedicada, Chief of Staff, A0–A4, equipes por capacidades e JARVIS. Controles Python são bancada, editorial/proveniência TypeScript reais. SSO/TLS/cofre/DR externo, conectores e sandbox/gateway integrados seguem pendentes. Obsidian opcional, UI não ensaiada; Graphiti não é autoridade histórica exclusiva.
'''
    (P/'RESULTS.md').write_text(text,encoding='utf-8')
    vendors={}
    for n in ['paperclip','LightRAG','langgraph','graphiti-audit']:
        q=R/'vendor'/n;vendors[n]={'sha':subprocess.run(['git','-C',str(q),'rev-parse','HEAD'],capture_output=True,text=True).stdout.strip(),'status':subprocess.run(['git','-C',str(q),'status','--porcelain'],capture_output=True,text=True).stdout.strip()}
    entries=[]
    for root,label in [(P,'load-and-capacity'),(Q,'quota-verification')]:
        entries += [(f,label+'/'+str(f.relative_to(root))) for f in root.iterdir() if f.is_file() and f.name not in ('manifest.json','package-result.json')]
        entries += [(f,label+'/'+str(f.relative_to(root))) for f in (root/'evidence').rglob('*') if f.is_file()]
    (P/'manifest.json').write_text(json.dumps({'files':{n:digest(f) for f,n in sorted(entries,key=lambda x:x[1])},'vendors':vendors,'summary':summary},ensure_ascii=False,indent=2),encoding='utf-8')
    target=R/'carga_corpus_custos_2026-11-04.zip'
    with zipfile.ZipFile(target,'w',zipfile.ZIP_DEFLATED) as z:
        for f,n in entries:z.write(f,n)
        z.write(P/'manifest.json','load-and-capacity/manifest.json')
    out={'path':str(target),'sha256':digest(target),'bytes':target.stat().st_size};(P/'package-result.json').write_text(json.dumps(out,indent=2),encoding='utf-8');print(json.dumps({'summary':summary,'package':out},indent=2))
if __name__=='__main__':main()
