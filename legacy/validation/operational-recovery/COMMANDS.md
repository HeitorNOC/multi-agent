# Comandos e evidências

- Cópia seletiva da implementação de expanded-evaluation, sem .state/evidence, para operational-recovery.
- Python fixado: `validation/integrated-pilot/.venv/Scripts/python.exe`. `cryptography` local 50.0.2. `prepare.py` executado uma vez, com codecs UTF-8 explícitos; corrigiu acentos apenas na nova cópia e adicionou controles/DDL. `application.py` recebeu ainda fault before_receipt e fingerprint com retry_of, posteriores ao script de transformação.
- `python -m py_compile` para application.py/controls.py/bundle.py/test_recovery.py: passou. Parse AST de todos os Python do novo diretório: passou.
- `python -X utf8 -m pytest validation/operational-recovery/test_recovery.py -q -s --junitxml=validation/operational-recovery/evidence/junit.xml`, usando o executável fixado e PYTHONIOENCODING=utf-8, com autorização normal de Docker/rede local/Codex: console completo em evidence/pytest-console.txt. Aviso herdado pytest-asyncio sobre loop scope; teste síncrono.
- `docker ps --filter name=recovery-audit --format ...`: verificou a inicialização de PG/Neo4j/IdP próprios. Prefixo exclusivo; sem alterações em outros recursos.
- Harness cria backups privados em `.state/<id>/joint-backup`; não são incluídos no ZIP de entrega. Roles/chaves/dumps contêm material sensível da fixture, mesmo sintéticos.
- Bundle corrompido tem bytes originais devolvidos pela fixture depois da recusa; journal e fonte adulterados para teste também são restaurados apenas após verificar o gate. Não houve reparo silencioso do resultado do teste.
- `python -X utf8 validation/operational-recovery/finalize.py`: gera RESULT/summary, hashes/SHA e ZIP apenas de código/evidências sanitizadas, sem .state/venv/pesos.
- Inspeção independente pós-teste com `docker ps -a`, `docker volume ls` e `docker network ls`, filtro name=recovery-audit e formato somente nome: saída vazia; nenhum recurso desta rodada remanescente.
- Leitura integral da resposta inédita em decisions.json identificou ressalva de vigência apesar de metadado canônico. Registrado FAIL_REVIEW em GATES.csv, separado do PASS do teste operacional. Não se refez a inferência nem se alteraram resposta/asserts.
