# Estudo comparativo para decisão conjunta — 05/11/2026

Orientação: estudar documentação, cursos/aulas, projetos open source e sistemas reais em conjunto; nenhuma fonte isolada determina arquitetura. A pesquisa anterior é ponto de partida, não encerramento do estudo. O usuário autoriza análise e protótipos delimitados, não produção/compras.

## Perguntas que cada fonte deve ajudar a responder

1. Quem controla a execução e como tarefas/equipes são compostas? Existe segundo agendador ou estado espelhado?
2. O que o checkpoint armazena? Qual a fronteira de retry/replay, por nó/tarefa/subgrafo e por processo?
3. Como distinguir erro transitório, resultado externo desconhecido e tarefa concluída? Quem deduplica o efeito?
4. Como revisão humana, autorização e orçamento sobrevivem a restart e revogação?
5. Como conhecimento persistente difere de estado do agente, arquivos de trabalho e memória conversacional?
6. O projeto traz testes/reprodução das afirmações ou apenas exemplos? Quais configurações são só locais?
7. O que pode ser usado por biblioteca, adaptado como padrão, copiado com licença ou exigiria fork e manutenção?

## Método

- Documentação oficial define o contrato declarado; conferir no código/versionamento e provas disponíveis.
- Cursos e aulas mostram composição e sequência pedagógica; notebook com memória RAM não é uma implantação persistente.
- Aplicações independentes permitem comparar decisões de integração, segurança e operação. README de produção não substitui testes, configuração ou relato técnico de operação.
- Relatos de empresas são evidência de adoção e desenho naquele escopo, não código reproduzível ou garantia transferível ao nosso produto.
- Fixar commits e capturar só arquivos relevantes, com licenças e hashes. Distinguir leitura integral de arquivo de inspeção seletiva do repositório. Não executar código de setup, notebooks com API paga, containers de terceiros ou scripts de instalação.
- Cruzar uma afirmação importante com pelo menos duas categorias quando disponíveis. Registrar ausência, contradição, suposição e confiança; quantidade de links/estrelas não pontua robustez.

## Saídas

Inventário de fontes e escopo lido, matriz dos padrões/limites, comparação de abordagens (core, harness composto, aplicação adaptada, runtime comercial, motor do zero), arquitetura de referência e decisões reservadas ao usuário. Preservar requisitos empresariais e os negativos anteriores. Não anunciar adoção ou produção com base apenas no estudo.
