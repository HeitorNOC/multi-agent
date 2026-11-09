# Jornada palpável: vendas e estoque

Aplicação local operável pelo navegador, com dados ACME fictícios e ação comercial **simulada**. Login corporativo adiado por orientação do usuário. Nenhuma mensagem, compra ou atualização em sistema externo é executada.

## Usar

Na raiz deste workspace, com Docker Desktop disponível:

```powershell
.\demo\Start-Demo.ps1
```

O endereço aparece em `demo/.state/launcher.log`. Abra-o no navegador. A interface fica disponível durante a preparação dos motores e informa quando as três fontes estão prontas.

1. Clique **Iniciar análise**. Este recorte aceita um pedido fixo sobre a empresa fictícia.
2. Acompanhe o plano do Chief of Staff e as capacidades de vendas e estoque; clique nos nós para detalhes.
3. Leia a síntese e abra as fontes/citações para conferir original, versão e SHA-256.
4. Revise destinatário e conteúdo da proposta. Aprove ou rejeite a ação simulada.
5. Para testar a falha controlada, use **aprovar e interromper após o recibo**. O worker termina antes do checkpoint final; **Retomar em novo processo** consulta a mesma intenção e conclui com o mesmo recibo.
6. Em trabalho concluído, **Verificar retomada sem repetir** inicia outro worker que lê o checkpoint. Sem nova análise ou nova ação.

Para encerrar:

```powershell
.\demo\Stop-Demo.ps1
```

O launcher remove apenas os containers/volumes que criou e cujo rótulo `qualification` confere com sua instalação. Não utiliza prune e não toca em recursos alheios. O estado local da sessão e evidências são preservados. Encerrar a sessão remove os bancos Docker descartáveis; reiniciar o launcher cria outra instalação, não restaura automaticamente a anterior.

## O que é real e o que é delimitado

| Parte | Implementação |
|---|---|
| Interface | React/TypeScript, estados e eventos reais; sem dados de execução pré-fabricados |
| API empresarial | TypeScript/Node; persistência SQLite de desenvolvimento; hash da proposta e aprovação por conteúdo exato |
| Workflow | LangGraph com PostgreSQL e `durability=sync`; worker em processo novo a cada execução/retomada |
| Conhecimento | LightRAG nativo, PostgreSQL/pgvector, Neo4j e embeddings ONNX locais, reaproveitados da bancada |
| Análise | Chamadas reais Codex Terra: planejamento, dois especialistas e síntese. Sem tools/rede/shell no subprocesso de inferência |
| Documentos | Três documentos fictícios do corpus já autorizado: vendas janeiro/fevereiro e estoque; publicação assinada por fixture, não revisão humana de produto |
| Efeito | Registro no quadro comercial local simulado, com intenção única por trabalho e recibo persistido |
| Login | Nenhum login corporativo; operador local de desenvolvimento. Endpoints internos têm token efêmero e bind loopback |
| Consumo | Tokens/calls observados; custo monetário desconhecido. Teto global de 16 reservas de modelo por instalação e quatro slots de análise por trabalho |

O pedido é transversal e o plano A3 está delimitado ao catálogo de duas capacidades. Ainda não é controlador adaptativo A0–A4. Os dois especialistas são tarefas LangGraph; o adaptador de inferência serializa chamadas de modelo, portanto não presumir ganho de latência.

As etapas `plan`, capacidades e `synthesis` têm slots persistidos antes da inferência; resultado conhecido pode ser reaproveitado no mesmo slot/prompt. Um slot sem resultado permanece desconhecido e bloqueia nova chamada automática. Isso não implementa o encerramento governado geral de `unknown` da bancada anterior.

Persistência do histórico original e dos efeitos é local nesta sessão. Não há promessa de backup/DR conjunto, auditoria externa autoritativa do efeito simulado, SSO empresarial, sandbox de código arbitrário ou capacidade de empresa grande. Os quatro FAIL anteriores não foram requalificados por esta jornada.

## Reaproveitamento e dependências

Reutiliza `BrainLab` e adaptadores em `validation/brain-recovery`, `validation/concurrent-reconciliation` e `validation/langgraph-business-flow`. Usa motores já instalados em `validation/integrated-pilot/.venv`, runtime ONNX e pesos já disponíveis. Não instala pacotes ou imagens novos automaticamente.

React 19.2.8, React DOM e esbuild 0.28.2 são resolvidos nos node_modules já existentes do workspace. Usar o compilador ou essas dependências não adota Paperclip como componente do produto. A aplicação possui código próprio em `demo/`; esta distribuição de desenvolvimento ainda depende dos caminhos da bancada e não é pacote autônomo comercial.

As imagens PostgreSQL/pgvector e Neo4j são fixadas por digest nos helpers existentes. O runtime LangGraph mantém o pin ensaiado; versão da sessão em `.state/<sessão>/environment.json`. `.state` contém credenciais efêmeras e logs privados e fica fora de exportações/versionamento.

## Verificar

```powershell
node demo/build.cjs
node --test demo/policy.test.ts demo/server.test.ts
node vendor/paperclip/node_modules/typescript/bin/tsc -p demo/tsconfig.json
& validation/integrated-pilot/.venv/Scripts/python.exe demo/test_journey.py
```

O teste integrado usa a sessão em execução e quatro chamadas reais de análise, além da ingestão feita pelo launcher. Cria um trabalho de teste, tenta aprovações inválidas e retomada sem grant, injeta saída 88 após o efeito, retoma e verifica um único recibo/efeito sem novas chamadas de modelo. Resultado em `evidence/journey.json`; não testa uma API externa real nem o produto empresarial completo.

O modelo propõe o texto. O backend verifica os fatos numéricos do corpus fechado, a lista de fontes e a ausência de causalidade estruturada comprovada. Isso é um grader deste cenário, não verificador semântico universal de cada frase da resposta.

JARVIS/3D, equipes dinâmicas, fontes canônicas/fatos/histórias separados e demais R01–R21 continuam no desenho do produto. A tela atual é o recorte operacional inicial. Keycloak/OpenFGA não fazem parte desta demonstração.
