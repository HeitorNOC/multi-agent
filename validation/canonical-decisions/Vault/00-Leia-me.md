# Vault empresarial de demonstração

Este diretório está pronto para ser aberto como vault no Obsidian. O aplicativo não foi encontrado nos caminhos locais verificados e não foi instalado automaticamente. A compatibilidade do formato e o fluxo de publicação são testados; a interface do aplicativo não foi homologada nesta máquina.

O vault é uma camada **opcional de edição**. O cérebro central, os índices, as permissões e o histórico de publicação pertencem à plataforma. Markdown continua utilizável por outros editores.

## Fluxo

1. Editar uma nota de proposta.
2. Submeter o conteúdo para revisão na plataforma.
3. Um revisor distinto aprovar o hash exato.
4. Publicar o snapshot aprovado; só então o backend de conhecimento poderá ingeri-lo.

Editar uma nota ou escrever “aprovado” no texto não concede autoridade e não modifica uma política publicada. Uma alteração depois da revisão exige nova proposta/revisão. Os documentos abaixo são **exemplos sintéticos, ainda não publicados por este vault de entrega**.

- [[Politica-Remota-v1]]
- [[Politica-Remota-v2]]
- [[Retificacao-Retroativa]]

Este perfil de importação aceita somente as propriedades escalares `source`, `version`, `valid_at` e `domain`, sem duplicatas, em YAML simples. Recursos YAML adicionais são rejeitados explicitamente, não interpretados silenciosamente. `domain` precisa coincidir com a classificação cadastrada na plataforma. Não inserir segredos, credenciais ou material confidencial neste exemplo.

Não há community plugins, scripts de templates ou sincronização configurados. Backlinks não concedem acesso a documentos de outro domínio.
