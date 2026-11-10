# Comparação seguinte: protocolo, ainda não executado

Data: 04/11/2026.

## 1. Filtro antes de instalar

Comparar bancada atual com Dify como possível base de workflows e Onyx como possível módulo de conhecimento; não combinar por padrão. Retomar candidatos já inspecionados se houver vantagem concreta.

Registrar release/SHA, imagem por digest, lockfiles, licenças da edição/dependências, distribuição/marca, APIs, auth, exportação e migração. Separar código disponível, edição paga, beta, promessa e comportamento executado. Exigir instalação dedicada e uma autoridade por trabalho.

Eliminar da função pretendida se requisito indispensável exigir substituição do núcleo, autoridade duplicada ou uso incompatível com licença. Buscar primeiro adaptação externa pequena. Ausência de documentação pede inspeção/teste, não reprovação automática.

## 2. Mesmo cenário funcional

Gestor pede análise entre áreas, recebe plano e aprova ação simulada reversível. Controlador escolhe capacidades e estratégia A0–A4 conforme tarefa, risco e orçamento. Mesmos documentos, vigências/publicações, ACLs, distratores e gabaritos para todos. Separar desenvolvimento e avaliação; revisar erros com humanos.

Comparar execução simples e especialistas quando úteis. Medir conclusão correta, fonte/versão, citações, abstenção, chamadas, tokens, latência e erros. Mais agentes ou uso de grafos não concedem vantagem por si.

## 3. Matriz obrigatória

| Ensaio | Critério necessário no conjunto testado |
|---|---|
| Duas APIs, repetição e queda antes/depois do efeito | Uma admissão/efeito simulado; saída original ou estado desconhecido governado, sem repetição silenciosa. |
| ACL/revogação durante execução e após backup | Nenhuma entrega proibida; restore não desfaz revogação. |
| Sandbox/injeção | Bloquear ações e acessos fora do escopo nos ataques definidos. |
| Quota parcial, esgotamento e cancelamento | Limites por trabalho/etapas; sem admissão indevida; conciliação do efeito já iniciado. |
| Correção retroativa e histórico | Distinguir o que valia, o que era conhecido e a resposta original, sob ACL atual. |
| Restore em volumes novos, upgrade/rollback | Integridade, revogações e quotas preservadas; migração reproduzível. |

Zero violações nos ensaios é condição necessária, não garantia universal. Não prometer exatamente uma vez sem suporte da API externa.

## 4. Capacidade e custo

Começar pequeno; aumentar corpus, conectores, concorrência e duração até encontrar saturação. Separar histórico de novas tarefas. Medir filas, p50/p95/p99, timeouts, recursos e throughput. Alvo de grande empresa não transforma fixture pequena em homologação.

Definir SLO, RPO/RTO, volume e teto por tarefa antes da homologação; metas ainda pendentes. Custo deve incluir ingestão, reindexação, falhas, inferência, infraestrutura, licenças e operação, a partir de consumo e preços/contratos verificáveis. Não converter tokens CLI ou reservas locais em preço de API presumido. Novos gastos fora da autorização existente exigem autorização específica.

## 5. Decisões possíveis

- GO para piloto delimitado: controles críticos passam, qualidade atende o conjunto aprovado, recuperação e custo medidos. Não significa produção ampla.
- Adaptar: lacuna delimitada com solução pequena demonstrada e manutenção comparável.
- NO-GO para candidato na função: requisito essencial falha sem adaptação aceitável; registrar causa e alternativa, sem reprovar a ideia inteira.
- GO de produção: produto integrado, segurança, operação, capacidade, recuperação e custo homologados. Nenhum candidato recebeu esta decisão.
