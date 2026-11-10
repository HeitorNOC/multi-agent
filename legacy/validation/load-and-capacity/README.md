# Corpus, filas e exaustão — 04/11/2026

Continua restore-concurrent-state, em instalação nova. Três fontes sintéticas aprovadas e isoladas por snapshot/workspace, duas públicas com regras conflitantes e uma financeira restrita. Este é corpus ampliado de validação, não corpus representativo de uma empresa grande nem consulta federada entre milhões de documentos. O registro de fontes/classificação é arquivo confiável da aplicação (registry.json), compartilhado com o editorial TypeScript; Markdown não define sua própria autorização.

Seis perguntas são executadas com LightRAG nativo mix e naive, mesma extração/embeddings e mesmo Terra, totalizando 12 respostas. Casos: alimentação Aurora/Boreal, prazo Aurora, revisão Boreal, teto financeiro Celeste e hotel ausente. Grader lexical e fonte/citação, dados nativos e canário privado; não é entailment completo, avaliação cega ou significância estatística. Ordem fixa e caches são limitações. Custos reais significam tokens e chamadas observadas; custo monetário não foi obtido.

## Medição

- Leituras exatas de decisões já gravadas: 40 pedidos com concorrência 1, 4 e 8 no perfil original; 80 com concorrência 8 no perfil experimental.
- Oito leituras durante uma inferência real em cada perfil. Perguntas diferentes e sem cache para haver CLI real nas duas janelas; não é comparação de velocidades dos modelos. A latência de leitura e sua fila são o alvo.
- Critério exploratório registrado antes da execução: p95 <= 1 segundo nas leituras históricas. Não é SLO empresarial contratado. O resultado de cada bloco é preservado, sem mudar o limite para obter aprovação.
- Cronometragem HTTP inclui validação JWT, DB, transporte e verificação de provas; exclui emissão prévia do token e não usa pooling HTTP do cliente. O wall time do bloco inclui o custo de logging do cliente. Métricas do servidor incluem queue_seconds; logs por instância evitam escrita concorrente no mesmo arquivo. Amostras Docker, quando presentes, cobrem somente containers e não API/embeddings/CLI no host ou modelo remoto.

## Dois ajustes experimentais da camada própria

O perfil original serializa inclusive GETs de histórico pela trava exclusiva de negócio. O perfil parallel_history usa leitura de registros imutáveis com grants atuais e checagem dos gates antes/depois. Se não há escritor exclusivo, adquire shared lock e confere o head retido. Durante um escritor ativo, permite somente histórico original, sem gerar resposta nova; não confunde intenção legítima em andamento com crash. Depois de crash sem escritor, a pendência na autoridade bloqueia as leituras. Freeze, recuperação e grants revogados continuam verificados. Isso não homologa todas as janelas de TOCTOU, falha da sessão PG, partição de rede ou failover.

quota_preflight é verificação antes de criar intenção/admission: quota cheia retorna 429. Não reserva antecipadamente todos os tokens/chamadas de um job nem resolve quota que se esgota no meio de ingestão ou geração. O controle atômico final continua na autoridade. O cenário original de quota cheia em fonte já ingerida é realmente executado via LightRAG e sua falha/efeito sobre histórico são preservados, depois encerrados por governança. Não se renova cap, não se apagam reservas e não se inventa sucesso. A comparação usa o mesmo cap cheio; o perfil experimental deve manter histórico disponível sem admission nova.

## Limites

Cap model=40 reservas de tentativa por instalação. A sobra é preenchida por reservas locais sem iniciar CLI para testar exaustão sem gastar dezenas de inferências. Execuções reais e reservas sem CLI são contabilizadas separadamente. O cap não é preço ou tokens, e seu esgotamento durante um job continua gate próprio.

Não houve restore frio completo depois do perfil novo; há regressões de freeze, grant atual e crash sem writer. Isso não transfere automaticamente o PASS de restore anterior à combinação nova. Autoridade/KEK no mesmo host e memória do harness, sem KMS/HA/PITR empresarial. Não se homologa escalabilidade ou custos de produção.

O E2E principal terminou com falha de expectativa do teste na última etapa: ele repetia o fingerprint de uma intenção já encerrada, recebendo corretamente 409. Não se trocou essa proteção por 429. A verificação complementar sem modelos demonstrou 429 para entrada nova, prioridade 409 para a encerrada e histórico disponível. O E2E principal não foi repetido após corrigir a entrada do teste. A tentativa inicial cancelada tinha uma reserva já feita sem usage capturado: seu consumo é desconhecido e separado das 31 saídas CLI concluídas.

Controles Python são bancada; mantidos TypeScript empresarial, editorial/proveniência TypeScript reais, LangGraph único owner, cérebro central, instalação dedicada, Chief of Staff, A0–A4 e equipes por capacidades. Integração completa, sandbox/gateway, SSO/TLS/cofre, conectores, JARVIS e corpus/carga empresariais continuam necessários. Obsidian opcional sem UI ensaiada; Graphiti não é autoridade histórica exclusiva.
