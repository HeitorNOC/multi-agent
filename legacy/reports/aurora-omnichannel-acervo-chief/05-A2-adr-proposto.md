# ADR A2 — Persistência e tratamento de erros

**Status — aprovado pelo usuário nesta conversa.** A aprovação abrange PostgreSQL com TypeORM, migrations SQL versionadas e mensagem genérica ao cliente em erros internos. O responsável é `technology_director`. A decisão se aplica ao novo núcleo compartilhado.

## Evidência documental

A diretiva indica Prisma como referência inicial, exige aderência aos padrões e veda NestJS e FastAPI (diretiva § 8). O padrão de backend REST prescreve PostgreSQL com TypeORM para serviços comuns e alterações manuais de schema sem migrations; também registra tecnologias diferentes em serviços existentes (D5 pp. 6, 12, 27–28, 40, 42). D5 é uma versão de trabalho e seus exemplos ainda não foram validados por uma feature completa (D5 pp. 1, 5, 44).

O guia separa domain de infrastructure, mantém entidades sem decorators de banco e determina acesso a dados de outro domínio por API (D5 pp. 8, 10–11, 16–18, 27–28). A diretiva exige núcleo compartilhado e integração com o Contact Center existente por contratos validados (diretiva §§ 7, 10, 14); os contratos e versões efetivamente implantados ainda precisam de confirmação (D2 pp. 1, 3, 18, 24–25).

D5 orienta retornar `error.message` no corpo, mas também proíbe expor SQL ou detalhes internos; as duas orientações podem conflitar (D5 pp. 20, 25, 31).

## Decisão aprovada

Adotar **TypeORM com PostgreSQL** para o novo serviço, preservando as camadas e convenções aplicáveis de D5. Prisma é referência inicial da diretiva, não uma imposição apresentada no material; TypeORM reduz a divergência com o padrão operacional e de código Tatodesk. A decisão não comprova superioridade técnica nem compatibilidade operacional já testada. NestJS e FastAPI permanecem vedados (diretiva § 8; D5 pp. 6, 12, 27–28, 40, 42).

A persistência ficará atrás de interfaces de domínio: models TypeORM, consultas e transformers pertencem à infraestrutura; entidades e usecases não importam o ORM. O novo núcleo controla seus dados e integra outros domínios por contratos autorizados, sem acesso direto ao banco do Contact Center. Consultas SQL necessárias serão parametrizadas e observarão o escopo de empresa (D5 pp. 8, 10–11, 16–18, 27–28, 31; diretiva §§ 7, 9–10).

**Exceções propostas ao padrão:** adotar migrations versionadas em vez de alterações exclusivamente manuais e sanitizar exceções inesperadas em vez de devolver sua mensagem original. O technology_director registra e submete ambas aos responsáveis pelos padrões Tatodesk; a liderança de tecnologia decide a aprovação. Até a aprovação, este ADR não autoriza apresentar as exceções como padrão aprovado.

## Alternativas

- **Prisma.** Segue a referência inicial da diretiva. Exigiria uma exceção à prescrição de TypeORM e validação das convenções operacionais de D5.
- **TypeORM com schema exclusivamente manual.** Segue a convenção de D5, com coordenação manual para reproduzir e rastrear mudanças. A aprovação registrada neste ADR autoriza migrations SQL versionadas.
- **SQL direto como estratégia principal:** poderia atender consultas específicas, mas ampliaria o trabalho de padronização e manutenção. SQL parametrizado continua disponível quando necessário, encapsulado na infraestrutura (D5 pp. 27–28).

## Schema e evolução

O responsável técnico de backend manterá migrations SQL versionadas, revisadas junto ao código e executadas por processo controlado antes da versão que delas depende. Cada mudança terá ordem, pré-condições, registro de execução e plano de reversão ou recuperação; alterações destrutivas exigirão plano explícito de compatibilidade e recuperação de dados. A equipe de banco/operação revisará execução, privilégios, backup e procedimento de recuperação. Comunicar mudanças ao time antes da entrega, conforme D5 pp. 27–28.

Para mudanças incompatíveis, usar etapas de expansão, adaptação dos consumidores e posterior remoção, após verificar que nenhuma versão ativa depende da estrutura antiga. Testar aplicação em banco vazio e atualização de uma versão anterior representativa, incluindo falha e recuperação. Não presumir que reversão de schema restaure dados apagados.

O desenho inicial deve permitir restrições e índices de escopo por empresa, unicidade para deduplicação, transações para estado e outbox e controle de concorrência; os detalhes dependem dos contratos e do modelo validados (diretiva §§ 9–10, 12–13). Retenção, criptografia e índices específicos permanecem decisões pendentes.

## Resposta de erro

Manter o envelope e códigos de D5 para os casos cobertos: erro esperado de validação ou precondição com mensagem em português deliberadamente segura e código 1; erro inesperado com mensagem genérica, por exemplo `Erro interno. Informe o identificador de correlação ao suporte.`, e código 2. Preservar HTTP 200 para os casos de usecase abrangidos pelo padrão, sem afirmar que ele cobre automaticamente falhas de middleware ou servidor (D5 pp. 19–20, 25, 31).

Registrar a exceção e a correlação em logs de acesso restrito, com política de retenção e filtragem de segredos e dados sensíveis; nunca enviar stack trace, SQL, credenciais, payload bruto ou mensagens arbitrárias de dependências ao cliente. O responsável técnico de backend implementará a tradução centralizada e testes; o responsável de segurança revisará mensagens e logs. O contrato de erros anteriores ao usecase, incluindo autenticação e falhas HTTP, será acordado com os responsáveis pelo padrão e documentado antes da integração.

## Impactos e verificações pendentes

- **Padrões.** Aplicar as demais convenções de D5 e alinhar a execução das migrations com a operação.
- **Operação e persistência:** validar versões, pipeline oficial, permissões e execução de migrations com backend e operações; testar transações, concorrência, isolamento entre empresas, recuperação e desempenho em ambiente representativo (D5 pp. 37–38, 44; diretiva §§ 9, 12).
- **Integração:** confirmar contratos, autorização e estados reais do Contact Center antes de acoplar persistência ou eventos (D2 pp. 9–18, 24–25; D4 pp. 5–6, 11). Capacidades MBA e seus eventos dependem de documentação oficial e testes reais (D7 pp. 3–7).
- **Segurança:** confirmar propagação autenticada de empresa e usuário, proteção de webhook e tratamento de dados sensíveis; D5 não especifica integralmente esses mecanismos (D5 pp. 22–23, 30–31).
- **Limite de evidência:** D1 e D3 são referências funcionais, e D6 é inventário; não demonstram implementação ou aprovação desta decisão (D1 pp. 1, 3, 6, 12–13, 16; D3 pp. 3–7, 10, 12; D6 pp. 1–3, 7–12, 21). Não houve consulta independente, implementação ou execução de testes nesta tarefa.
