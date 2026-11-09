# Auditoria das 11 perguntas da diretiva omnichannel

A reprodução local manteve as perguntas, as páginas autorizadas e o hash do manifesto da execução original. A lista reconstruída para o primeiro agente coincidiu com as localizações registradas pela API. A união para a síntese foi reconstruída com o mesmo limite de 24 trechos. O registro original contém as citações finais, mas não preserva os IDs da seleção intermediária. Para um trecho presente na união e ausente do parecer, a perda só pode ser localizada entre a síntese e a verificação.

| Nº | Requisito | Diagnóstico e encaminhamento |
|---|---|---|
| 1 | Responsabilidades e fluxos | **Evidência parcial preservada.** O parecer citou a separação de serviços e a mudança de sessão no Fluxo, p. 12. O detalhamento de responsabilidades precisa ser tratado por componente. |
| 2 | Contratos Kafka | **Evidência parcial na lista da síntese, ausente do parecer.** Fluxo, p. 12, menciona um tópico consumido. Schema, versão, chave de partição e regras de reentrega seguem como decisões de arquitetura. |
| 3 | Estados e transições | **Evidência parcial preservada.** Contact Center, p. 9, lista estados. O trecho sobre passagem para `PAUSED` na p. 15 apareceu na busca individual e ficou fora dos 24. A máquina completa exige modelagem e testes. |
| 4 | Confirmação oficial do handoff MBA | **Documentação oficial e homologação.** O Fluxo, p. 10, descreve o evento interno. A confirmação de disponibilidade e comportamento do provedor exige a fonte oficial e um teste na configuração alvo. |
| 5 | Dados pessoais no histórico | **Evidência parcial na lista da síntese, ausente do parecer.** Contact Center, p. 11, menciona metadados do cliente. O inventário de campos, a finalidade e o acesso devem ser definidos a partir dos contratos reais. |
| 6 | Retenção dos eventos | **Decisão de arquitetura pendente.** A gravação do evento bruto e do histórico normalizado consta do Fluxo, p. 10. A auditoria das páginas autorizadas não encontrou prazo ou regra de expurgo. |
| 7 | Isolamento entre empresas | **Decisão de arquitetura e teste.** Contact Center, p. 15, descreve permissões operacionais do atendente. A prova de isolamento entre empresas depende de autorização e de testes entre tenants. |
| 8 | Auditoria do handoff | **Referência fragmentada.** A síntese recebeu apenas a frase genérica sobre auditoria do Fluxo, p. 10. A linha completa menciona o registro do payload bruto, e Contact Center, p. 15, descreve o registro de transferência. Definir os campos obrigatórios do handoff e conferir seu registro em teste. |
| 9 | Primeiro fluxo vertical obrigatório | **Fonte presente fora da busca.** A diretiva, § 10.4, enumera as dez etapas. Usar essa seção como fonte normativa e rastrear as etapas aos testes do protótipo. |
| 10 | Sequência das integrações | **Fonte presente fora da busca.** A diretiva, § 11, estabelece seis fases. Usar essa seção para o backlog e conferir as dependências antes de iniciar a fase seguinte. |
| 11 | Continuidade do histórico | **Teste de execução pendente.** Fluxo, p. 10, descreve a gravação do histórico, e Contact Center, p. 13, descreve a recarga após reconexão. Esses trechos ficaram fora dos 24. Verificar o histórico acessível ao atendente antes e depois da transferência, com IDs das mensagens e ordem preservados. |

O verificador da diretiva agora pode examinar os 24 candidatos autorizados. A seleção da síntese continua ordenando os primeiros trechos. Os candidatos restantes ficam disponíveis para a verificação, com os rótulos validados e convertidos de volta a referências canônicas. Um teste pela API com provedor simulado passou. Nele, a síntese selecionou apenas a regra de início da contagem, e o verificador recuperou também o prazo, que estava entre os candidatos. O teto por pedido permaneceu como lacuna. A melhoria no parecer com os PDFs reais ainda precisa ser medida. As questões normativas da diretiva ainda requerem integração da fonte à recuperação.

[Reprodução da busca e candidatos por pergunta](aurora-omnichannel-lacunas-replay.json) · [Parecer original](aurora-omnichannel-api-rotulos-curtos-reteste.json)
