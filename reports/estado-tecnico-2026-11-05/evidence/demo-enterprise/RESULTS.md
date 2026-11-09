# Ensaio Aurora — 05/11/2026

**Resultado global: FAIL. Seleção/delegação demonstradas; confiabilidade documental ainda insuficiente. Produção permanece NO-GO.**

Painel ativo: http://127.0.0.1:58678 . Empresa, operações e documentos são fictícios; motores, recuperação e inferências Codex Terra são reais. Nenhuma ação externa foi executada.

O Grupo Aurora representa uma empresa com 18.400 colaboradores, sete países, quatro unidades de negócio e 12 centros de distribuição. Esses números descrevem o cenário, não usuários simultâneos nem capacidade medida. Há 16 documentos vigentes, uma versão histórica não indexada e um catálogo de 21 agentes: sete diretores com dois especialistas cada, além do Chief como controlador. O corpus tem documentos curtos com dependências cruzadas; não equivale a milhares de contratos longos.

## Escolhas reais do Chief

| Pedido | Selecionados | Inativos | Resultado |
| --- | --- | --- | --- |
| Campanha Horizonte e oportunidade Orion | 8: Marketing + planejador de campanhas; Operações + suprimentos; Finanças + controladoria; Jurídico + conformidade | 13 | Parecer rejeitado pelo verificador |
| Primeira avaliação INC-47 no CRM | 4: Tecnologia + segurança; Jurídico + conformidade | 17 | Parecer aceito; aprovação humana pendente |

O modelo recebeu o catálogo completo. A política limita até quatro diretorias/oito agentes e valida a hierarquia, mas não impõe quais áreas serão escolhidas. As verificações posteriores de cobertura pertencem ao ensaio, não ao roteador. Executivos e RH ficaram disponíveis sem inferência nos dois pedidos. Todos os excluídos receberam justificativa. As equipes foram diferentes; somente selecionados tiveram slots de inferência. Os especialistas executaram em subgrafos LangGraph; seus diretores receberam os retornos e consolidaram; o Chief sintetizou.

## Falha documental da campanha

O briefing projeta 5.000 **pedidos**; Comercial esclarece que a campanha prevê 5.000 **unidades incrementais**, distintas das 6.000 unidades Orion. O gabarito exige cenário combinado de 11.000 unidades e insuficiência de 8.000 diante de 3.000 livres. A recuperação/sumarização não preservou essa reconciliação até a síntese: o modelo declarou demanda e insuficiência desconhecidas. O verificador rejeitou `combined_demand_units`; não se mudou o gabarito nem o candidato para convertê-lo em PASS.

O candidato acertou estoque livre de 3.000, margem de 26,24% versus mínimo vigente de 28%, caixa livre de R$130 mil, verba de R$180 mil e lacuna de R$50 mil. Também distinguiu suprimento não confirmado e alegação ambiental sem prova. Esses acertos parciais não aprovam a decisão completa. O candidato rejeitado está em `evidence/decisions.json`; o painel mantém a falha.

**Adaptação necessária:** resolver referências entre fontes vigentes e conferir o texto canônico associado ao hash antes de aceitar uma alegação de ausência de dados. A evidência atual não isola se a perda ocorreu na recuperação ou na consolidação dos modelos. Instrumentar a cobertura de trechos por etapa e repetir a campanha, acrescentando testes de unidades e contradições. Não tratar contexto de grafo/vetor como leitura integral garantida. Não mascarar o problema com respostas pré-programadas no prompt.

## Incidente e recuperação

O parecer distinguiu 1.200 contatos potencialmente envolvidos de exfiltração não confirmada. Calculou 25 minutos decorridos e 65 restantes no SLA interno fictício de 90 minutos. Não confundiu contatos com unidades comerciais. Foram seis slots: planejamento, quatro agentes e síntese. A retomada em novo processo ficou aguardando aprovação sem chamada adicional nem recibo de efeito. Aprovar no painel registraria somente uma proposta no comitê local simulado.

## Falhas e uso observado

1. Primeira tentativa: limite de embedding fragmentou documentos e multiplicou extrações. Interrompida com 23 reservas, 22 chamadas concluídas e uma de resultado desconhecido. Evidências preservadas.
2. Segunda tentativa: nome do embedding gerou identificador PostgreSQL longo demais; startup falhou sem nova inferência. Nome encurtado.
3. Sessão atual: 16 fontes indexadas. Corrigida a decodificação UTF-8 entre Node/Python no Windows; retomado o checkpoint da campanha sem repetir seus agentes. A síntese fez uma chamada e foi rejeitada pelos fatos. Confirmação posterior reutilizou o resultado armazenado.

A sessão atual completou **32 chamadas**: 16 de ingestão, dez da campanha e seis do incidente. Total entre tentativas: **55 reservas de 64**, incluindo a reserva desconhecida. Há 471.017 tokens de entrada, dos quais 314.112 em cache, e 33.723 de saída na sessão atual. Não há medição de custo monetário comercial.

Embedding local com pooling processou 412 segmentos em 76 lotes; máximo efetivamente enviado de 120 tokens WordPiece por segmento, zero entradas registradas como truncadas. Pooling preserva cobertura de texto, mas sua qualidade de recuperação não foi homologada. Não confundir ausência de truncamento com ausência de perda semântica.

## Verificações e decisão

Oito testes de política passaram; dois testes de segmentação/pooling passaram; strict TypeScript e regressão da API compartilhada passaram. O teste integrado registra resultado global FAIL por causa da campanha, preservando o PASS delimitado do incidente. Os hashes e versões estão em `evidence/source-manifest.json` e `evidence/session.json`; comandos e adaptações em `COMMANDS.md`.

**Decisão:** a experiência de cérebro central e equipes sob demanda foi demonstrada neste catálogo fechado. A campanha complexa expôs uma falha de integridade da decisão entre documentos. Manter o protótipo como bancada e corrigir esse ponto antes de ampliar a autonomia. Este ensaio não homologa arquitetura completa, documentos arbitrários, carga empresarial, sandbox geral, DR nem custo de produção. Os quatro FAIL históricos da V1 continuam abertos. Requisitos R01–R21 e a preferência por LangGraph permanecem preservados.
