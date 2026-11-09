# Comandos e evidências — 04/11/2026

- Cópia apenas de arquivos de implementação de `canonical-decisions` para `expanded-evaluation`, sem `.state`, logs ou credenciais. Serviços com prefixo exclusivo `expanded-audit-<id>`; SHA/digests herdados fixos.
- `validation/integrated-pilot/.venv/Scripts/python.exe validation/expanded-evaluation/prepare.py`: aplicou as mudanças documentadas à cópia, uma vez.
- `validation/integrated-pilot/.venv/Scripts/python.exe -m py_compile validation/expanded-evaluation/application.py validation/expanded-evaluation/test_expanded.py`: passou.
- `validation/integrated-pilot/.venv/Scripts/python.exe -X utf8 -m pytest validation/expanded-evaluation/test_expanded.py -s -q --junitxml=validation/expanded-evaluation/evidence/junit.xml`: execução com permissão normal para Docker/local/Codex. Console integral em evidence/pytest-console.txt. Aviso pytest-asyncio sobre loop scope não configurado; teste é síncrono, sem fixture assíncrona.
- Inspeção independente `docker ps --filter name=expanded-audit --format ...`: PG/Neo4j/IdP inicializaram. Nenhum serviço de outro projeto alterado.
- Verificação independente durante a execução: `docker exec -i expanded-audit-413d9db127-pg psql -XqAt -v ON_ERROR_STOP=1 -U decision_writer -d pilot`, stdin `UPDATE decision_receipts SET record_json='tamper';` e depois `DELETE FROM decision_receipts;`: ambos exit 3, permission denied. Não alteraram recibos. Resultado em evidence/receipt-permissions.json. Não fazem parte do único caso pytest.
- Injeções de falha: harness arma arquivo privado, espera checkpoint e termina o processo da API. Arquivos disconnect-*.json registram a desconexão observada; depois o mesmo armazenamento/identidades são reabertos.
- `validation/integrated-pilot/.venv/Scripts/python.exe -X utf8 validation/expanded-evaluation/finalize.py`: consolidação e ZIP sem `.state`, sem modelo ONNX, sem virtualenv ou credenciais.
- Pós-teste, `docker ps -a --filter name=expanded-audit`, `docker volume ls --filter name=expanded-audit` e `docker network ls --filter name=expanded-audit`, todos com formato somente nome: nenhuma saída. Limpeza independente confirmou ausência de recursos remanescentes desta bancada.

Uma busca inicial por `vendor/LightRAG/lightrag/llm/roles.py` não encontrou esse caminho; configuração por papel foi lida em `lightrag.py`. A comparação adotada não muda papéis do índice: repete os prompts finais com Sol. Não houve alteração do código vendor.
