# Registro — mapa de reaproveitamento, 05/11/2026

Workspace PowerShell C:\Users\PC\multi-agent. Orientação explícita: procurar/reutilizar processos existentes e integrá-los à solução própria. Sem mudança de código da PoC, compra, instalação ou release.

1. Inventariados estudos anteriores e buscas `rg` por componentes. Não recomeçada avaliação de todos os frameworks. Conector GitHub não utilizado novamente após timeout documentado na rodada anterior; fallback API pública para consultas delimitadas.
2. Buscas web de casos/adoção: Keycloak case studies/SRE/HA, OpenFGA CNCF/adopters/consistency, gVisor users/security/compatibility e LiteLLM customers/production. Referências primárias ligadas no mapa. Algumas buscas retornaram fontes secundárias e métricas agregadas inconsistentes; os números de repositório no mapa vêm da API capturada.
3. Executado, com acesso de rede autorizado:

```powershell
& 'validation/python/cpython-3.11.18-windows-x86_64-none/python.exe' research/reuse-map-2026-11-05/collect.py
```

Seis consultas de metadados e de commit HEAD; captura de README/licença por SHA. Nenhum código capturado foi importado/executado. `repositories.json` inclui falha inicial 404 para Keycloak `LICENSE`; caminho correto `LICENSE.txt` identificado na árvore e capturado depois, preservando a tentativa inicial.

4. Árvores completas de Keycloak/OpenFGA via API, ambas `truncated=false`, gravadas em `keycloak-tree.json` e `openfga-tree.json`. Capturados CONTRIBUTING.md, LICENSE.txt de Keycloak e CONTRIBUTING.md, pkg/server/check.go e check_test.go de OpenFGA. Inspeção seletiva com `rg` por Consistency/cache/validação e nomes de testes; nenhuma execução Go/Java.
5. LiteLLM API informou licença NOASSERTION; lido LICENSE completo curto, que separa Enterprise do restante MIT. Fonte oficial de incidente v1.107.0 identificada na busca e conferida. Nenhuma instalação feita. Não declarar versão segura apenas porque HEAD tem commit recente.
6. OpenFGA: docs de consistência, RAG e autorização por tarefa; diferenciados checks condicionais de reserva/contagem atômica. Caso Grafana explicitamente limita rollout externo a shadow/preprodução no relato consultado.
7. Demonstração MCP Dev Summit: README web inspecionado. Vídeo `IVIvtusd7LA` falhou por cache miss, sem transcrição validada; não alegar visualização. Exemplo não classificado como motor de produção.
8. Uma URL presumida de detalhe CERN retornou erro; usado o índice oficial de casos, que contém a descrição. Outputs locais extensos com base64 de badge ou texto truncado não foram tratados como leitura integral; feitas consultas curtas pertinentes.
9. Verificação offline de hashes dos arquivos com captura bem-sucedida e referências locais do mapa; resultado `verification.json`. Falhas de download históricas permanecem registradas. Verificação documental não requalifica V1.
