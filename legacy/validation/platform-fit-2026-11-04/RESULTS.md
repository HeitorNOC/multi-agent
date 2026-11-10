# Qualificação inicial: Dify/Graphon, Onyx, Glean e ServiceNow

Data: 04/11/2026. **Produção continua não aprovada.** Esta rodada executou testes de componentes e sandbox; não instalou a plataforma Dify ou Onyx completa. Glean e ServiceNow foram avaliados documentalmente, pois o usuário confirmou não possuir instâncias de avaliação.

## Código, ambiente e execução

| Item | Referência fixada |
|---|---|
| Dify | `eea40c683bbc8d2a396f80ee25ebfef1555a84ad`, manifest API 1.18.0, Python requerido ~=3.13.0 |
| Onyx | `332b908f4a05090882ffaf7219d904c467bb7ce1`; leitura dirigida de código/licenças/overlay |
| Graphon | `4fa22141774dff80e90e4dfa98ea3e6fbf0421bb`, 0.8.0, SHA exigido pelo manifest Dify |
| Sandbox | `langgenius/dify-sandbox:0.2.15`, digest `sha256:750e1111426ef31a9217b81c98cccfb750f17b182af3221102e420afa9f0928e` |
| Testes Python | Python 3.12.14, venv própria; dependências mínimas em `environment.txt`, sem sincronizar o lock completo |
| Python do sandbox | 3.14.4 observado na imagem; é processo separado do motor, não o ambiente dos testes Graphon |

Dify e Onyx usam os SHAs capturados na investigação anterior, não uma alegação de latest. Fontes adicionais foram obtidas pela API GitHub nesses SHAs. O arquivo Graphon foi baixado pelo codeload porque a ferramenta de arquivos não fornece o arquivo completo de checkout; 813.197 bytes, SHA256 `5dc7c2713a3a780bd6d77daec723d403ed4690f813917de49d01e204e5e32dc8`, 442 arquivos. Ver [manifest do motor](../../research/platform-fit-2026-11-04/graphon-manifest.json) e [referências dos arquivos](../../research/platform-fit-2026-11-04/source-references.json). O hash do arquivo compactado é evidência da captura, não assinatura do fornecedor.

## Testes executados

| Prova | Resultado | Alcance |
|---|---|---|
| Graphon `test_runtime_state.py`, `test_runtime_state_serialization.py`, `test_code_runtime.py` | **45 PASS, 9,69 s** | Estado/snapshots, compatibilidade de versões, quiescência, pausa/retomada e protocolo de chamada ao sandbox. Usa fixtures e adaptadores simulados upstream; sem banco durável ou modelos reais. |
| Dify `test_stop_aware_ready_queue.py` | **4 PASS, 1,75 s** | Código Dify e Graphon reais; consulta ao sinal externo de parada substituída por módulo mínimo e mocks. Não executa Redis, API ou worker Dify. |
| Sandbox real | Resultados abaixo | HTTP real dentro de contêiner, sem modelo, sem dados de cliente e sem montar arquivos do usuário. |

Artefatos: [JUnit Graphon](graphon-upstream.xml), [log Graphon](graphon-upstream.log), [JUnit Dify](dify-queue.xml), [log Dify](dify-queue.log). Nenhuma alteração de comportamento foi feita no código upstream; testes dirigidos foram executados conforme permitido pelo CONTRIBUTING. Não se executou a suite inteira nem os processos de desenvolvimento de um patch upstream.

## Sandbox: observações reais e negativo preservado

Contêiner de teste com rede Docker interna, sem volumes do host, 512 MiB, 1 CPU, limite de 128 processos, sem modo privilegiado. A imagem inicia como root; isso requer avaliação da fronteira interna e não significa, por si só, acesso root ao host. A política testada não é uma configuração empresarial homologada. O roteiro foi copiado para `/tmp` e chamou a API por loopback interno.

| Caso | Observação |
|---|---|
| Health | HTTP 200 antes e depois das falhas |
| Pedido sem chave | HTTP 401 |
| Código simples e cálculo finito | Saídas esperadas, incluindo `4999950000` |
| Leitura de marcador criado no filesystem do serviço | `FileNotFoundError`; conteúdo não entregue ao código isolado |
| Leitura de `/proc/1/environ` | `FileNotFoundError`; conteúdo não entregue |
| Socket externo solicitado | `OSError`, sem conexão observada; não foi determinado qual controle impediu o acesso |
| Criação de subprocesso | Erro de operação proibida; log do serviço registra `signal: bad system call` |
| Loop infinito e espera de 7 segundos | **Timeout não validado.** Marcadores de início apareceram, seguidos de erro de operação proibida em aproximadamente 0,07–0,08 s. Não foram encerramentos pelo prazo configurado |
| Código simples após falhas | Executou com saída esperada |

Há um problema de compatibilidade/política a esclarecer: uma espera legítima é interrompida por syscall proibida nesse ambiente. Causa raiz não determinada; não afrouxamos seccomp para obter PASS. HTTP 200 e `code: 0` podem acompanhar `data.error` preenchido, portanto a integração deve inspecionar o erro interno.

A configuração consultada do Dify habilita rede e usa chave de exemplo; o adaptador DSL do Graphon solicita rede. Nossa implantação restringiu conectividade externamente. Isso não comprova bloqueio seguro por padrão nem escape impossível. Dois caminhos de arquivo, um socket e um subprocesso são uma amostra limitada. Faltam testes de persistência entre trabalhos, separação de usuários, exfiltração por ferramentas, todos os runtimes e demais ataques.

Evidências: [resultados iniciais válidos](sandbox-results.json), [complemento de compatibilidade](sandbox-followup-results.json), [logs completos](sandbox-runtime-complete.log), [implantação](sandbox-deployment.json). A primeira tentativa pelo Windows falhou com conexão recusada devido à publicação de porta na rede interna; foi preservada em `sandbox-results-host-transport-failed.json`, sem contar como bloqueio de ataque. A API interna respondeu e permitiu a repetição. Contêiner e rede de teste foram removidos após salvar evidências; imagem e arquivos locais foram mantidos.

## Decisão por função

- **Camada própria + bancada atual:** manter como referência comparativa, sem ampliar alegação de produção.
- **Graphon:** admitir como candidato alternativo de motor para próximo ensaio. Execução dirigida e licença Apache-2.0 justificam investigar composição externa; ainda faltam persistência durável de negócio, identidade, custos, modelo real e efeitos remotos. Não substituímos LangGraph nesta rodada.
- **Dify completo:** candidato condicional; contratos e adaptação ainda necessários. A licença e edição precisam cobrir nosso modo dedicado, workspaces e frontend. Não presumir que usar apenas o motor Graphon concede direitos sobre o restante do Dify.
- **Onyx:** manter como candidato de conhecimento; não qualificado nesta rodada por execução. O perfil Lite desativa conectores e RAG, portanto não serve para homologar esse módulo. Código empresarial tem licença própria e precisa entrar no custo/condições de distribuição.
- **Glean/ServiceNow:** avaliação comercial/técnica condicionada a acesso e condições concretas; nenhum teste nativo executado, nenhum contrato solicitado.

Comparação empresarial detalhada e fontes: [REPORT.md](../../research/platform-fit-2026-11-04/REPORT.md). Os requisitos do dossiê e todos os negativos anteriores permanecem; nenhum desses resultados constitui GO de produção.
