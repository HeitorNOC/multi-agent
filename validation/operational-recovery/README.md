# Encerramento governado e restauração conjunta — 04/11/2026

Este ensaio continua `expanded-evaluation`, em diretório/instalação próprios. Não modifica vendors, não publica produção e não executa ações empresariais externas. Instalação dedicada; cérebro lógico central; TypeScript empresarial/editorial, motores Python; LangGraph continua o único workflow owner proposto. Não há homologação nova de Chief of Staff, A0–A4, equipes dinâmicas, JARVIS ou aplicativo Obsidian.

`controls.py` é código de bancada para qualificar contratos e falhas, assim como a API Python dos ensaios anteriores. Não redefine a camada empresarial de produção como Python. Implementar os controles empresariais na camada TypeScript e integrá-los ao owner LangGraph continua um gate; o editorial TypeScript permanece real nesta prova. O lock da API não constitui um novo motor de workflow aprovado.

## Contrato de pedido sem recibo

- O fault privado `before_receipt` interrompe realmente a API depois de haver consumo do modelo/retorno nativo, antes do recibo da camada empresarial. Cache interno e logs de provider não são automaticamente aceitos como recibo do pedido.
- A admissão mantém o resultado desconhecido; não é promovida a sucesso nem declara ausência de gasto/efeitos.
- Governança consulta evidência atual, fecha com motivo e hash exato. Closure é imutável/idempotente. O proprietário não fecha seu próprio pedido. ID encerrado não executa de novo.
- Uma segunda identidade board, diferente de quem encerrou, autoriza um novo ID com entrada exata e proprietário original. Mesmo fingerprint encerrado com ID novo sem vínculo é recusado. O registro novo contém `retry_of`; o anterior continua sem resposta final.
- Esse controle compara entradas e fingerprints, não detecta reformulações semânticas arbitrárias nem substitui políticas de orçamento/risco do controlador completo.

## Bundle frio coordenado

Com um único writer local o harness captura inventário, para API/IdP/Neo4j e cria dumps PostgreSQL de pilot/knowledge/identity + roles, dump offline Neo4j, backup SQLite via API transacional, Vault e diretório da aplicação. Chaves editorial/journal são cifradas com AES-256-GCM e AAD da instalação; KEK fica na memória do harness, fora do bundle. Manifest de arquivos/inventários assinado com HMAC. A bancada não qualifica KMS, custódia externa, perda total do host, rotação ou recuperação independente de todas as credenciais. Roles/dumps/keys ficam somente em `.state` privado, fora do pacote de entrega.

Restore valida assinatura, nomes de arquivos, tamanho/hash e unwrap antes de alterar containers desta instalação. Cria volumes PG/Neo vazios e novos caminhos SQLite/Vault/aplicação. Carrega roles, três bancos e grafo. API inicia com gate persistente; reiniciar a API não abre o serviço. Governança só abre quando inventários coincidem e o journal retido é válido.

Inventário: hashes completos dos registros/recibos/admissões/closures/autorizações/projeções/fontes/principais; todas as linhas das tabelas públicas do knowledge PostgreSQL; dump lógico SQLite; nós/arestas e propriedades Neo4j. Grants esperados são os do backup menos as revogações posteriores do journal. Tokens do IdP são obtidos novamente contra o banco restaurado.

Journal de revogação e contador de chamadas ficam fora do rollback. Eventos têm sequência/HMAC/hash anterior e anchor separado. Truncamento quebra a verificação; falha entre append e atualização do anchor bloqueia a retomada, sem reparo automático. Os dois arquivos continuam no mesmo host: não é armazenamento inviolável ou DR independente. Múltiplos writers não são seguros nesse journal/contador em arquivo.

## Limites

Um bundle internamente coerente não comprova atualidade de fontes/conectores. Este recorte modifica apenas grants após o backup e testa sua reaplicação. Não homologa eventos posteriores de publicação, decisões, closures ou autorizações perdidas no rollback, nem substitui o gate de frescor/inventário externo qualificado em ensaios anteriores. Nenhuma dessas garantias deve ser presumida na integração final. PITR, HA, falha do host, cofre/SSO/TLS e tráfego empresarial continuam pendentes.

`prepare.py` documenta as transformações da cópia; execução única. Foi corrigida no novo arquivo uma corrupção de acentuação introduzida pelo leitor default Windows no prepare anterior. Prompts/evidências originais continuam intactos; o modelo havia respondido aos fatos corretamente. Leituras/escritas novas usam UTF-8 explícito.

Execução:

```powershell
$env:PYTHONIOENCODING='utf-8'
validation/integrated-pilot/.venv/Scripts/python.exe -X utf8 -m pytest validation/operational-recovery/test_recovery.py -q -s --junitxml=validation/operational-recovery/evidence/junit.xml
```

Cap 40 invocações Terra por instalação, não limite monetário. Provider Codex, LightRAG nativo e embeddings ONNX reais; imagens/SHA fixos herdados. Fixtures de datas/perguntas e protocolo em evidence/protocol.json. Dados são sintéticos; nenhum benchmark de escala empresarial.
