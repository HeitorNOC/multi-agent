# Ensaio ampliado — 04/11/2026

Continuação isolada de `canonical-decisions`; não altera os vendors nem aprova produção. Instalação dedicada descartável, corpus sintético maior e quatro perguntas com oráculos registrados antes da inferência em evidence/protocol.json.

1. Mesma fonte aprovada e mesma projeção de extração Terra/embeddings MiniLM: comparar LightRAG nativo `mix` e `naive`, com quatro perguntas (valor, prazo, dupla revisão e informação ausente).
2. Executar Sol com os quatro prompts finais exatos da condição mix. É comparação de geração com contexto fixo, não fatorial completo nem avaliação de extração Sol. A ordem fixa e possíveis caches impedem inferência de velocidade/preço relativo.
3. Oito pedidos idênticos concorrentes no mesmo processo: exigir envelope idêntico e um único registro. A serialização por lock local não representa capacidade empresarial nem múltiplas réplicas.
4. Interromper o processo depois do recibo durável, antes do commit final. Exigir pendência explícita, conciliação por governança, resposta original e nenhuma nova inferência. Revogação atual do proprietário deve impedir promoção do recibo.
5. Interromper depois da admissão, antes de existir recibo: exigir bloqueio sem repetição cega. Esse caso continua sem recuperação automática; não inventar uma resposta nem chamar o modelo novamente sob o mesmo ID.

`decision_receipts` contém a resposta original com hash antes do commit final. O papel runtime pode INSERT/SELECT, sem UPDATE/DELETE; isso não protege contra DBA. `/reconcile` aceita apenas ID e exige identidade verificada com papel board e grants atuais de governança e proprietário original. A injeção de falha usa arquivo privado da bancada, sem endpoint público.

Cap de 40 invocações Codex por instalação, sequenciais no provider. Não é orçamento monetário. As chamadas Sol de comparação são feitas depois da API ficar ociosa, reutilizando contador e logs; o contador em arquivo não é seguro para múltiplos processos concorrentes. Nenhuma ação empresarial externa é executada. Serviços auxiliares herdados do harness não contam como conectores homologados.

Critérios lexicais verificam apenas valor/abstenção e presença de citação/filename, separadamente. Não comprovam entailment completo, precisão estatística ou qualidade geral. O corpus inclui regras Aurora/Boreal e números distratores, mas continua uma única fonte/snapshot público, longe de um corpus empresarial.

Mantidos os requisitos de instalação dedicada, cérebro central lógico, camada empresarial TypeScript, motores Python, LangGraph como único workflow owner, controlador A0–A4, Chief of Staff, equipes por capacidades e Obsidian opcional. Esta bancada testa o serviço de conhecimento/assessoramento; não implementa nem homologa o produto completo.

Executar no diretório raiz com o Python já fixado da bancada:

```powershell
$env:PYTHONIOENCODING='utf-8'
validation/integrated-pilot/.venv/Scripts/python.exe -X utf8 -m pytest validation/expanded-evaluation/test_expanded.py -s -q --junitxml=validation/expanded-evaluation/evidence/junit.xml
```

`prepare.py` registra as transformações aplicadas à cópia do baseline. Não o executar novamente sobre o código já transformado. Configurações de modo/modelo são internas da instalação; o caller não escolhe workspace ou autoridade.
