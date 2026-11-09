# Piloto consultivo local do Aurora

Este perfil executa uma tarefa aberta contra uma cópia autorizada de documentos reais. Usa o Chief, a hierarquia de agentes e os checkpoints LangGraph do Aurora. A resposta apresenta trechos verificáveis e passa pela revisão humana. A aprovação só registra um recibo local.

## Preparar a entrada

Escolha uma tarefa de uma área e uma pasta dedicada. O manifesto dentro dessa pasta declara os únicos arquivos que a sessão pode usar. O piloto aceita TXT e Markdown UTF-8, até 24 versões e 64 KiB por arquivo. Para um PDF ou DOCX, prepare primeiro uma transcrição autorizada e verifique o texto antes de publicar. Para os casos de revisão, uma versão anterior pode aparecer no mesmo manifesto com `current: false`.

```json
{
  "version": 1,
  "documents": [
    {
      "source": "politica-reembolso",
      "version": 2,
      "current": true,
      "classification": "model-approved",
      "title": "Política de reembolso",
      "area": "Financeiro",
      "origin": "Cópia autorizada pela área responsável",
      "file": "reembolso-v2.md",
      "sha256": "<hash SHA-256 do arquivo em minúsculas>"
    }
  ]
}
```

Use `model-approved` somente quando o responsável autorizar que trechos do arquivo sejam processados pelo Codex. Use `local-only` quando o conteúdo precisar ficar no host. Neste recorte, o Aurora verifica o hash e mostra os metadados das fontes locais, mas não as utiliza para montar a resposta. O launcher rejeita referências fora da pasta, hashes divergentes, versões duplicadas e versão vigente que não seja a mais recente registrada para a fonte.

## Iniciar e operar

Use o ambiente [dedicado do Aurora](ORGANIZACAO_AURORA.md#instalar-e-iniciar-em-windows) e um terminal interativo. A sessão do piloto tem diretório e bancos próprios.

```powershell
& apps/aurora/.venv/Scripts/python.exe -X utf8 demo-enterprise/start.py `
  --pilot-manifest 'C:/caminho/pasta-autorizada/manifest.json' `
  --pilot-user operador --pilot-viewer consulta
```

O terminal pede as senhas sem exibi-las. `--pilot-viewer` é opcional. Abra o endereço local impresso, entre como operador e escreva a tarefa em uma linha com até 600 caracteres. A pergunta também será processada pelo Codex. Use apenas contexto cuja transmissão esteja autorizada. O perfil de consulta pode ler os resultados, e o operador pode admitir trabalhos e registrar a revisão. A aprovação fica vinculada ao parecer e à identidade da sessão.

O piloto inicia com um worker, teto de 24 reservas de modelo e duração de duas horas. Com a fila ociosa, o operador pode usar **Encerrar e apagar sessão**. Ao encerrar normalmente, o launcher remove os recursos temporários que criou. Uma interrupção forçada do processo ou do host pode deixar recursos isolados remanescentes, que exigem limpeza local. O piloto foi desenhado como sessão descartável, com retomada do worker dentro da sessão e sem restauração do piloto após encerrar o launcher.

## O que o piloto transmite e guarda

- O planejamento envia a pergunta e o catálogo de agentes. A seleção envia até seis trechos candidatos de até 480 caracteres. Os trechos vêm de fontes vigentes e aprovadas para o modelo. A busca padrão usa correspondência de termos no host. A indexação do piloto não usa chamadas externas. Esse perfil usa a busca local de trechos e não a extração por grafo do LightRAG.
- Especialistas e diretores registram seleções de IDs. A síntese recebe as seleções anteriores e pode devolver uma lista vazia. Quando propõe citações, um slot separado recebe somente a pergunta e os trechos propostos para verificar pertinência. O backend exige recibos da síntese e do verificador antes de montar as citações a partir do acervo autorizado, com versão, linha, texto literal e hash. Uma saída inválida do verificador mantém o trabalho em recuperação sem parecer.
- O painel mostra a cobertura parcial e destaca as lacunas. O backend aceita como lacuna somente texto literal da pergunta original. A etapa adiciona até uma chamada por trabalho ao orçamento do piloto. Uma seleção vazia segue para revisão como evidência insuficiente e dispensa essa chamada.
- O piloto conserva a tarefa, o parecer com os trechos selecionados, os recibos e os checkpoints na sessão temporária. A telemetria usa referências e métricas. O adaptador do Codex deixa de gravar arquivos de prompt, stdout e stderr nesse perfil. A política local não controla o tratamento de dados no serviço remoto.
- A resposta é consultiva e extrativa. A correspondência por termos pode deixar de encontrar sinônimos ou relações entre documentos. Revise os trechos com alguém da área antes de usar o parecer.

### Comparação de recuperação

Um documento pode declarar `context_lines` no manifesto. Informe os números de linha da transcrição, a partir de 1, que correspondem a um parágrafo curto, um item de lista ou uma linha de tabela conferida no original. Cada linha autorizada aceita de 12 a 480 caracteres. A busca ranqueia as frases como antes. Para uma frase selecionada em linha anotada, o piloto devolve o texto integral daquela linha e remove blocos repetidos sem adicionar novos candidatos. O bloco tem ID próprio e conserva a fonte, versão, hash do arquivo e número da linha. Deixe sem anotação as linhas que misturam colunas ou unidades de conteúdo. Manifestos sem o campo seguem com recuperação por frases.

O padrão continua lexical. Use `--pilot-retrieval hybrid` para avaliar o ranking que combina similaridade dos embeddings locais com termos em comum. O índice fica em memória, aceita até 4.096 trechos autorizados e segue o mesmo limite de seis candidatos por tarefa. A geração de embeddings usa o serviço local da instalação e os pesos fixados.

Para uma avaliação assistida, `--pilot-facets arquivo.json` aceita um objeto com `goal` (a pergunta exata) e `facets` (até seis objetos com `query` e `anchors`). As consultas e âncoras auxiliam apenas a recuperação local para aquela pergunta. O modelo de resposta recebe a pergunta original e os trechos recuperados. Registre separadamente os resultados com e sem esse vocabulário.

### Referência financeira no laboratório

Ative o recorte dedicado com `--pilot-refund-reference <arquivo.json>` e `--pilot-refund-public-key <chave pública Ed25519 em hexadecimal>`. Configure a chave de confiança por um canal separado da publicação documental. O JSON contém `payload` e `signature`. A assinatura em hexadecimal cobre o JSON canônico do `payload`. A fixture de validação gera registros e chaves fictícios para o ensaio.

O recorte qualifica a pergunta exata “Qual é o prazo de reembolso para o cliente?” e o formato explícito de prazo em dias úteis. Na criação do parecer, o backend confere a assinatura, a vigência, a fonte e a versão e compara o prazo. Um parecer confirmado registra o hash da referência no conteúdo vinculado à revisão. Divergência ou ausência de confirmação gera `review_rejected` e impede a criação da revisão. Outras perguntas também ficam sem revisão nesse perfil.

A API verifica novamente a referência antes da aprovação e antes do primeiro efeito simulado. A referência precisa corresponder ao hash salvo no parecer. A substituição, divergência ou retirada observada antes da aprovação encerra aquele parecer e exige outro. Se a mudança for observada após a aprovação e antes do efeito, o worker perde a autorização para gerar o recibo. Recibos de efeitos já registrados continuam disponíveis para conciliação. [Protocolo e resultados](../reports/aurora-autenticidade-e-ferramentas.md)

No perfil de referência financeira, um operador autenticado pode revogar a versão pelo `POST /api/pilot/revoke-reference` com `job` e `hash` do parecer. A revogação vale para o emissor, campo, fonte e versão do parecer na instalação local. A API grava a revogação no mesmo banco do efeito e consulta esse registro dentro da transação que criaria o primeiro recibo. Alterar o arquivo diretamente continua sujeito às conferências por leitura. Use a rota de revogação para obter a ordenação transacional no laboratório.

O ensaio de reinício usa `--pilot-recovery-lab` com busca lexical e diretório de estado dedicado. Esse perfil guarda metadados de retomada protegidos pelo usuário Windows, incluindo manifesto, configuração da referência, contas locais e prazo de expiração. Só reanexa a mesma instalação depois de conferir a identidade dos recursos Docker e constatar que os contêineres anteriores estão parados. Use o roteiro automatizado para executar e limpar esse ensaio descartável. [Teste de reinício](../validation/aurora-local-restart/test_pilot_connector_restart.py)

## Verificação executada

Passaram três testes do piloto. A prova integrada usou LangGraph, PostgreSQL e a API reais com um provedor controlado. O teste bloqueou leitura e aprovação sem sessão, recusou aprovação pelo perfil de consulta e registrou a identidade do operador ao aprovar. Citou a política v2, com prazo de 15 dias úteis. A captura confirmou que nem a política revogada nem a fonte local, nem o parágrafo irrelevante do original, chegaram ao provedor de teste. A pergunta sem suporte gerou abstenção e a seleção adversarial de uma fonte irrelevante foi rejeitada. Ao encerrar, o diretório temporário, os contêineres e os volumes da sessão foram removidos. [JUnit do piloto](../validation/aurora-local-restart/pilot-04.xml)

Passaram ainda 36 regressões Node, o build, TypeScript, o ensaio no Edge para login, tarefa aberta e encerramento e a restauração da demonstração. Os ensaios usaram material fictício. [JUnit da demonstração](../validation/aurora-local-restart/post-pilot-demo-01.xml)
