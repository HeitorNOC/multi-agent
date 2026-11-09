# Busca por fato na API consultiva

O launcher aceita um adaptador local no executor de laboratório. O adaptador recebe o mesmo corpus autorizado do piloto. Ele identifica o cenário por termos da pergunta, usa as três consultas documentais da bancada, reserva até oito candidatos por consulta e reaproveita BM25, embeddings e reranqueamento local. As citações carregam os trechos canônicos. A sessão usa autenticação, fila, worker, verificação e revisão do Aurora. O classificador semântico e a rodada complementar do utilitário de bancada ficam fora deste ensaio.

Na primeira rodada, a recuperação apresentou as três evidências esperadas entre 23 candidatos. O parecer citou o estado ativo e a mudança de sessão, mas omitiu o evento de transferência. O resultado foi 2/3 em 72,61 s. As três requisições com a mesma chave resultaram em um trabalho e uma inicialização de worker.

A segunda rodada acrescentou as subquestões a todas as etapas de seleção. Um especialista recebeu `ValueError` no serviço de inferência e a tarefa chegou a `recovery_required`. O diagnóstico reteve apenas a classe da exceção. A terceira rodada concentrou a instrução na síntese e reiterou o campo único e o limite de quatro IDs.

Para reproduzir, use o comando do [teste de admissão](aurora-piloto-api-reentrega.md), troque `--hybrid-auto` por `--handoff-runtime-lab` e informe um arquivo de saída novo. O Ruff e os dois testes existentes da busca híbrida passaram.

[Primeira execução](aurora-piloto-api-fatos.json) · [Segunda execução](aurora-piloto-api-fatos-sintese.json)

A terceira execução chegou à revisão humana em 75,47 s com as três evidências da régua. Citou `ACTIVE` na p. 9 do Contact Center, a mudança para `HUMAN` na p. 11 do Contact Center e `control_passed` na p. 10 do Fluxo de Mensageria. A quarta citação descreveu o encaminhamento de mensagens na sessão humana. O parecer manteve “sem que ambos respondam ao mesmo tempo” como lacuna. Os reenvios voltaram ao mesmo ID, com um trabalho e uma inicialização de worker.

A validação pela API cobre uma execução bem-sucedida do enunciado original com a configuração final de laboratório. Os outros enunciados e controles foram medidos na bancada. O teste de concorrência e reentrega no WhatsApp continua pendente do handler do canal.

[Terceira execução](aurora-piloto-api-fatos-sintese-isolada.json)
