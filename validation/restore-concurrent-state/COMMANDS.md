# Comandos e evidências

- Cópia seletiva de concurrent-reconciliation, excluindo .state, evidências e chaves, para novo prefixo restore-state-audit-<id>.
- `validation/integrated-pilot/.venv/Scripts/python.exe -X utf8 prepare.py`: transformação única UTF-8. bundle.py/maintenance.py/test_integrated.py receberam mudanças explícitas adicionais; fontes críticos têm fingerprints no bundle.
- `python -m py_compile` passou nos novos módulos e teste integrado. Quatro unitários de piso de quota passaram: aumento retido permitido; reset, cap alterado ou escopo ausente recusados. Console/JUnit em evidence/unit-*.
- `validation/integrated-pilot/.venv/Scripts/python.exe -X utf8 -m pytest validation/restore-concurrent-state/test_integrated.py -q -s --junitxml=validation/restore-concurrent-state/evidence/integrated-junit.xml`, PYTHONIOENCODING=utf-8, com revisão normal para serviços locais/Codex. Console integral em integrated-console.txt e exit code do pytest preservado. Aviso pytest-asyncio herdado sobre scope; teste síncrono.
- Pausas/falhas são armadas em arquivos privados vinculados à instância; não há endpoint público para injetar falhas ou liberar a pausa. O harness confirma o marker antes de avançar.
- Para simular formato antigo confiável, somente a fixture troca o campo de formato e recalcula a assinatura com sua chave privada local; espera recusa antes de remover containers e depois devolve os bytes originais.
- Adulterações de tabelas e reservas ocorrem apenas em bancos/arquivos próprios da instalação descartável. A autoridade é parada antes de copiar/alterar seu SQLite, usando sqlite3.backup; reparo posterior usa a cópia privada anterior. Nenhum diretório recursivo é apagado nem nenhum recurso de outro projeto manipulado.
- Código/evidência sanitizada apenas no ZIP. Dumps, roles, keys.enc, arquivos .state, pesos e ambientes não são entregues.
- E2E concluiu sete checkpoints: `1 passed in 483.30s`, quatro testes de pisos já aprovados. Sem rerun ou correção posterior da implementação.
- Inspeção independente pós-teste: `docker ps -a`, `docker volume ls` e `docker network ls`, filtro name=restore-state-audit, formato só nome: saída vazia. Recursos próprios removidos.
- Consolidador confere todas as assinaturas/nonce/instalação/completude das provas preservadas, usando timestamp da requisição histórica, e diferencia número de execuções CLI de reservas. A prova de reset é filtrada pelo mesmo head do checkpoint completo e contagem abaixo do piso; zeros iniciais legítimos não são classificados como rollback.
