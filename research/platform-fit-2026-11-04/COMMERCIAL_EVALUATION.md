# Roteiro para Glean e ServiceNow — sem contato externo efetuado

Este documento especifica informação e acesso necessários à avaliação. Não é solicitação enviada a fornecedor, autorização de compra ou promessa de disponibilidade.

## Entregáveis necessários antes da prova

| Área | Evidência solicitada para a oferta concreta |
|---|---|
| Implantação | Região, versão, tenant/instância por empresa, operação cliente/fornecedor, rede/egress, chaves, suporte e acessos administrativos. Glean: distinguir Customer Hosted e customer-managed. ServiceNow: família, Private Stack e matriz de recursos. |
| Uso como nosso produto | Direitos de interface própria, embedding/API, revenda/OEM/MSP e distribuição por cliente; contrato e limitações de marca. |
| Identidade | Usuário, conta de agente e conta de serviço; delegação e continuidade quando iniciador sai da empresa; trilhas de aprovação e revogação. |
| Dados | Conectores necessários, ACL e prazo de sincronização, exclusão, residência, retenção de fornecedores de modelo, exportação e restauração. |
| Execução | Idempotência, filas, reexecução, cancelamento e efeitos admitidos, durabilidade de run, APIs estáveis/experimentais e limites. |
| Histórico | Fontes/versionamento/vigência/publicação, correção retroativa, saída original, auditoria imutável e ACL atual ao ler histórico. |
| Segurança | Versões corrigidas, sandbox, segregação entre execuções, política de rede, ferramentas e segredos; responsabilidade por patches. |
| Operação | Backup, PITR, RPO/RTO e restauração testável; exportação da configuração, migração e rollback de aplicação. |
| Custos | Base/licenças, quantidade mínima, instâncias de teste/produção, uso de agentes/modelos/conectores, infraestrutura própria, implantação, suporte e operação. Não basta preço por usuário. |

## Ensaio pequeno comum

Corpus sintético aprovado, dois domínios, dois usuários com permissões diferentes, fontes com vigência/publicação e uma ferramenta simulada com efeito e recibo auditáveis. Controle de workflow atribuído a uma única autoridade. Nenhum dado real de cliente.

1. Análise e proposta com fonte/versão verificável; comparação com fluxo simples sem especialistas.
2. Aprovação antes da escrita; testar mudança de plano após aprovação e identidade divergente.
3. Repetir pedido e interromper conexão antes/depois do efeito; não duplicar a ação.
4. Revogar acesso durante run e depois de backup; impedir entrega indevida e rollback da revogação.
5. Encerrar/retomar com continuidade autorizada se o iniciador deixar a organização.
6. Esgotar limite durante tarefa de várias etapas; verificar concorrência e cobrança, não apenas tela de limite.
7. Reproduzir resposta histórica original sem regenerar, aplicando ACL atual.
8. Exportar/restaurar em ambiente separado; medir tempo, perda e integridade, com escopo contratado.

Glean: comparar web/API e Slack privado/compartilhado; confirmar quais endpoints duráveis/Usage estão disponíveis e com que estágio. ServiceNow: comparar invocador, run-as e ferramentas, conferir família/apps corrigidos e consumo real de Assists. Não executar ataques contra serviços de terceiros fora do ambiente de avaliação autorizado.

## Resultado esperado da avaliação

Tabela de requisitos atendidos por execução, configuração, adaptação, edição paga e não atendidos. Logs sanitizados, versões, custos observados, erros e limites. Decisão: adotar como plataforma, usar como módulo, manter como referência ou rejeitar na função. GO para piloto delimitado e GO de produção são decisões distintas.
