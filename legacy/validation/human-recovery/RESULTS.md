# Integração da central humana — 05/11/2026

**PASS no recorte integrado da central com o protocolo empresarial existente. Produção permanece NO-GO.** Interface compilada, API real, duas sessões independentes e operações governadas em processos/PostgreSQL reais, com provedor controlado e zero chamadas de modelo nesta rodada.

## Entrega funcional

O componente **Precisa de você** foi incorporado ao Aurora e disponibilizado também em `/recovery`. Lista casos, mostra bloqueios e histórico, inspeciona uma evidência específica e envia proposta/confirmação à autoridade existente. A interface não atribui agentes, não gera respostas e não retoma LangGraph por conta própria.

O ambiente operacional deixado para revisão usa http://127.0.0.1:61621 . Seus dois casos são fictícios e estão pendentes: leitura com recibo conhecido e inferência desconhecida. As credenciais de teste ficam em arquivo privado indicado pelo inicializador. O ambiente de análise Aurora anterior foi preservado; suas propostas não foram aprovadas por esta entrega.

## Contratos implementados

| Endpoint | Função |
| --- | --- |
| `GET /api/recovery/session` | Informa habilitação e identidade da sessão atual |
| `POST /api/recovery/session` | Autentica uma credencial local; cookie opaco HttpOnly/SameSite Strict |
| `POST /api/recovery/logout` | Encerra a sessão atual |
| `GET /api/recovery/cases` | Lista/histórico autorizados, sem mutação do workflow |
| `POST /api/recovery/inspect` | Inspeciona `case_id` explícito e obtém operação/hash atuais |
| `POST /api/recovery/propose` | Registra primeira revisão vinculada a caso/operação/evidência/justificativa |
| `POST /api/recovery/confirm` | Exige outra identidade atual e confirma pelo protocolo |
| `GET /api/recovery/commands` | Envios do revisor atual, filtrados pelo acesso atual ao caso |
| `POST /api/recovery/retry` | Reconsulta/reenvia o comando original vinculado; não chama inferência nem envia efeito |

O ID do envio fica vinculado ao ator e ao conteúdo. Reutilização com outro conteúdo ou revisor é recusada. Envios iguais simultâneos compartilham uma única chamada em andamento nesta instância. O journal persiste antes do transporte; restart transforma `dispatching` em `unknown`, preservando a necessidade de consultar a autoridade.

Resposta perdida após confirmação não transforma o trabalho em falha nem dispara uma nova geração. O segundo revisor pode consultar o envio original e obter a decisão já retida. Resultado bruto do modelo/recibo semântico não é copiado para a resposta da central; ela mostra resumo e hash.

Sessões são armazenadas por hash, expiram e perdem validade com rotação da credencial. Cookies são específicos por instalação. A identidade vem da sessão, não de um campo `actor`/`reviewer` ou cabeçalho fornecido pelo cliente. Credencial de ponte separada impede o worker de acionar governança usando somente seu token de runtime.

Inspeção e lista verificam a instalação da ponte. A confirmação revalida grants atuais inclusive no replay de um envio já concluído. Revogação impede nova leitura do journal desse caso, sem apagar o registro original de conclusão. Uma restauração antiga deixa a fila explicitamente bloqueada, sem divulgar histórico como se estivesse autorizado/atual.

## Testes executados

| Execução | Resultado |
| --- | --- |
| Suíte Python principal: integração + dez casos de recuperação + regressões + votos | **16 PASS, 183,64 s** |
| Dois cenários da central repetidos após o guard final de restauração antiga | **2 PASS, 16,76 s** |
| Dois cenários com contrato final de inspeção de fonte/recibo/justificativa | **2 PASS, 16,95 s** |
| Duas regressões repetidas em destinos de export isolados | **2 PASS, 44,48 s** |
| Node: sessões, isolamento, políticas, eventos, HTTP, efeitos e provas | **33 PASS, aproximadamente 1,75 s** |
| TypeScript strict de API/UI e protocolo | **PASS** |
| Build dos dois pontos de entrada React | **PASS** |

Os recortes Python finais repetem casos da suíte; não somar como testes independentes. Os dez casos de recuperação mantêm os cenários de queda/restore e os contratos anteriores. Nenhum PASS histórico foi reescrito como se tivesse sido obtido nesta implementação.

A inspeção mostra fonte/versão/hash, hash do input, estado do provedor, hash do recibo conhecido, reserva/unidades contabilizadas e a justificativa da primeira revisão. Estado pending/unknown não é rotulado como recibo de resultado. O resumo não expõe a resposta semântica bruta.

### Cenários centrais comprovados via HTTP

1. Sem sessão ou com credencial inválida, não há acesso aos casos.
2. Campos/cabeçalhos tentando escolher outro revisor não concedem autoridade.
3. Worker com seu token, sem o segredo separado de ponte, recebe recusa.
4. Duas sessões têm identidades distintas; primeira identidade não confirma sua própria revisão.
5. Reinício da API mantém sessão válida e revisões retidas.
6. Duas confirmações simultâneas do mesmo envio fazem uma única chamada concorrente e não repetem a operação.
7. Resposta cortada depois do commit remoto fica unknown no journal; consulta do envio original após restart recupera o resultado retido.
8. Leitura conhecida preserva o recibo e não devolve resultado semântico bruto à central.
9. Unknown encerra sem resposta inventada nem devolução da reserva; uma execução por ID permanece comprovada no provedor.
10. Múltiplos unknown exigem seleção explícita. A operação pendente anterior bloqueia outra; evidência obtida antes de mudança de inventário é recusada.
11. Revogação após conclusão impede replay/leitura de histórico do caso; o journal original continua completed.
12. Backup antigo deixa a fila bloqueada e sem histórico liberado por grants obsoletos.

Houve testes de cookie opaco/HttpOnly/SameSite, rotação de credencial, cookie de outra instalação e ponte configurada para outra instalação. A identidade de teste não representa homologação de SSO ou duas pessoas reais.

## Falhas, adaptações e preservação

O primeiro teste reutilizou um ID para enviar evidências diferentes; a API recusou corretamente. O roteiro foi corrigido para exigir essa recusa e usar outro ID para outra tentativa. O mesmo cuidado foi aplicado aos envios de revisores distintos. `first.xml/log` preservam a falha; não se relaxou a vinculação do comando.

O primeiro typecheck apontou imports TSX sem extensão sob NodeNext. Os imports foram corrigidos e o strict final passou.

**Limitação de evidência histórica:** a suíte principal reutilizou um roteiro antigo que gravava exports em destinos fixos. Foram substituídos os `results.json` e `authority-public.json` de `observability-recovery/detached-regression-evidence` e `governed-regression-evidence`. Logs/JUnit, negativos originais e streams privados anteriores permaneceram, mas esses quatro exports não são mais os originais daquela rodada. As chaves públicas exportadas antigas desse recorte não foram recuperadas; não se recontam esses streams antigos como novamente verificáveis.

Os exports da execução que substituiu os anteriores foram copiados com essa procedência para `regression-imported-current`. Um wrapper novo redireciona as próximas regressões para esta pasta e foi executado com sucesso. Os arquivos não foram apresentados como restauração exata dos anteriores. As evidências do protocolo por instalação, com IDs únicos, não tiveram essa colisão.

A interface teve compilação e contratos HTTP completos verificados. Não há uma nova inspeção visual automatizada do navegador nesta rodada: a restrição anterior de captura não foi contornada por outro meio. Não se anuncia screenshot como entregue.

## Escopo e decisão

O código da central está integrado ao servidor/interface do MVP e ao bootstrap Aurora atualizado. A demonstração ao vivo usa o mesmo código com casos operacionais controlados para não reingerir documentos nem consumir modelos. A sessão Aurora anterior continua com o servidor que já estava carregado.

**Esta ponte não migra automaticamente os slots diretos de LLM da demo (`model-slots.sqlite`) para o ledger de recuperação.** Sua vinculação a IDs/recibos estáveis e cobertura de todas as categorias do produto continuam pendentes. A central cobre os casos do protocolo conectado, não toda falha possível de qualquer agente.

Há deduplicação concorrente local e persistência do journal; múltiplas instâncias da API compartilhando esse journal exigem qualificação própria. Também permanecem ACL/SSO/TLS de produção, segredos recuperáveis, migração empresarial PostgreSQL, testes de carga, DR externo, conectores e orçamento monetário real. JARVIS/3D e R01–R21 continuam preservados.

**Decisão:** continuar integrando o domínio e as categorias de inferência à infraestrutura governada, mantendo LangGraph como owner. A central é uma entrega funcional delimitada; não constitui GO de produção.

## Conferência offline da entrega

O verificador final conferiu **1.851 assinaturas** dos exports atuais, coerência de instalação/nonce/head/sequência, resultados JUnit e logs de strict/Node. `verification.json` registra o recorte e `manifest.json` fixa os arquivos públicos por SHA-256. A leitura inicial sem UTF-8 explícito alterava os acentos no payload durante a verificação; foi corrigida, sem relaxar a validação criptográfica. A suspeita inicial de troca de chave não se confirmou. Isso não recupera as chaves dos quatro exports históricos substituídos, cuja limitação permanece registrada acima.

A raiz de trabalho atual não tem metadados Git; nenhum commit foi criado nesta entrega.
