# Ciclo operacional exercitado

1. Criar prefixo exclusivo, rede e volumes novos; usar imagens por digest e portas localhost. Criar bancos e identidades SQL separados, incluindo runtime sem superuser. Inicializar Keycloak e clientes de laboratório.
2. Publicar corpus g1 por journal LightRAG, checar processamento e selecionar geração atomicamente na camada própria. Autorizar fontes antes de recuperar contexto ou servir cache. Falhar fechado quando o domínio agregado contiver fonte sem permissão.
3. LangGraph executa duas capacidades, persiste checkpoint e interrompe para aprovação. Plano fixa intenção, versões e epoch. Nenhum worker pode se conceder aprovação por prompt ou payload.
4. Parar writers, aplicação, identidade e grafo; gerar pg_dump de pilot/knowledge/identity, globals e dump offline Neo4j; copiar objetos e calcular manifesto SHA. Retomar os serviços somente após a captura fria.
5. Simular alterações posteriores de fontes e revogação. Fsync do diário HMAC de segurança fora do conjunto restaurado. Injetar perda de resposta após commit do provedor. Manter obrigação pendente, sem declarar sucesso por timeout.
6. Validar hashes antes de restaurar. Restaurar bancos e grafo em volumes novos, objetos em diretório novo. Não apagar diretórios calculados recursivamente. Manter gate de recuperação fechado (503).
7. Verificar objetos, geração e consultas reais; aplicar eventos externos de revogação e invalidar aprovações antigas. Neste teste abre-se a geração histórica g1. **Em produção faltaria validar atualidade de fontes/políticas externas antes de aceitar novas decisões.**
8. Aprovar novo plano do exemplo histórico; novo processo retoma checkpoint nativo, consulta recibo estável antes de enviar; concilia reserva/outbox/custo, sem repetir leituras nem entrega.
9. Encerrar subprocessos e remover somente recursos Docker do prefixo exclusivo. Manter dumps privados fora da entrega. O encerramento do teste não é rotina de retenção de dados empresariais.

Dependências de recuperação externas: diário de segurança, recibos do provedor e chaves/configuração do operador não sofreram rollback. Sem esses elementos não se pode repetir a garantia observada. Uma cópia conjunta dos bancos não substitui conciliação com o mundo externo.
