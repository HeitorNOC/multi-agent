# Handoff pela API e reenvio concorrente

O ensaio abre uma sessão descartável do Aurora, autentica um operador e envia o enunciado original a `POST /api/jobs`. Duas threads aguardam a mesma barreira antes de enviar o mesmo corpo e a mesma chave de idempotência. Um terceiro pedido repete a chave depois que as duas respostas chegam. O coletor acompanha `GET /api/state` até a revisão e registra IDs, trabalhos visíveis, inicializações de worker, citações e páginas.

A sessão usa a busca híbrida disponível no launcher com os três recortes do piloto e os distratores sintéticos. O roteamento e a busca por fato validados no utilitário de bancada ainda precisam ser conectados a esse caminho da API. Os quatro recortes adicionais usados na bancada permanecem fora da sessão.

```powershell
$env:PYTHONPATH = (Resolve-Path 'apps/aurora/.venv/Lib/site-packages').Path
$python = 'C:/Users/PC/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/python.exe'
& $python -c "import sys; from pathlib import Path; sys.path.insert(0,'validation/.tools/aurora-piloto-handoff'); from run_mixed_corpus import prepare_mixed, execute; sys.argv.extend(['--hybrid-auto','--admission-replay']); execute(prepare_mixed, output=Path('reports/aurora-piloto-api-reentrega.json'))"
```

O teste do canal precisa do handler de mensageria e de uma saída observável para registrar os envios. A busca por `MESSAGING_HANDOVER`, `control_passed` e `startAttendance` nos projetos locais não localizou a implementação. O critério é disparar bot e atendente para a mesma mensagem durante a transferência, reentregar o mesmo evento e conferir um único envio autorizado e nenhum efeito adicional.

As três requisições devolveram o mesmo ID. A API mostrou um trabalho e o histórico registrou uma inicialização de worker. O Chief acionou Tecnologia e Atendimento. A tarefa chegou a `awaiting_approval` em 51,42 s e o parecer retornou `insufficient_evidence` com zero citações. A sessão temporária encerrou. O Ruff passou no coletor.

O reenvio de admissão passou neste cenário. O critério documental de 3/3 pela API ficou pendente. A regressão de oito casos permanece como evidência do utilitário de bancada. O próximo teste documental depende de conectar a busca por fato ao runtime consultivo e repetir a régua pela API. O teste no canal depende do repositório ou ambiente do handler.

[Resultado da API](aurora-piloto-api-reentrega.json) · [Regressão da bancada](aurora-piloto-regressao-final.md)
