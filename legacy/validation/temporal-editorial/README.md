# Conhecimento temporal e fluxo editorial — 04/11/2026

Esta rodada implementa um componente editorial TypeScript e testa Graphiti real com fontes aprovadas. Leia `RESULTS.md` para os resultados, `DECISION.md` para decisões por componente e `COMMANDS.md` para reprodução e falhas.

O [vault de exemplo](Vault/00-Leia-me.md) pode ser aberto no Obsidian como pasta existente. O aplicativo não foi encontrado nos dois caminhos locais verificados; não foi instalado e sua interface não foi testada. O fluxo usa Markdown comum e não depende de community plugins ou serviço de sincronização.

`editorial.ts`: propostas, revisão distinta, hash exato, snapshot canônico imutável e seleção da fonte por vigência/conhecimento. SQLite é a persistência local desta prova de componente, não uma decisão de substituir PostgreSQL no produto.

`application.py`: API autenticada com Keycloak, grants de fonte, publicação em fases e SDK Graphiti protegido. `graphiti_adapters.py`: inferência real Sol/Terra e ONNX local, sem extrator temporal próprio. `test_temporal.py`: mesmo critério temporal aplicado aos dois modelos. `test_publication.py`: falha entre grafo e commit editorial, bloqueio e conciliação após restart. `editorial.test.ts`: testes da camada editorial.

Não confundir seleção da **fonte aprovada** com reconstrução de todos os **fatos extraídos** no passado. O primeiro contrato é da nossa governança; o segundo foi submetido à aceitação nativa do Graphiti e falhou no recorte indicado nos resultados.

`.state` contém bancos/arquivos privados de laboratório e não integra a entrega; ambientes, pesos e caches também são excluídos. Nenhuma produção, mensagem real ou dado empresarial confidencial foi utilizado.
