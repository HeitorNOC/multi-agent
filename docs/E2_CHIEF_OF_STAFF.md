# E2 — Chief of Staff na conversa

Status (09/11/2026): conversa entregue; Chief of Staff por regras (padrão) ou por modelo via CLI local.

## Como ligar o modelo

Na configuração da instalação:

```json
{ "chief": { "engine": "model", "provider": "claude" } }
```

| Campo | Valores | Padrão |
|---|---|---|
| `engine` | `"rules"` ou `"model"` | `"rules"` |
| `provider` | `"claude"` (Claude Code) ou `"codex"` (Codex CLI) | obrigatório com `model` |
| `model` | nome do modelo da CLI | o padrão da conta do usuário |
| `timeoutMs` | tempo máximo por decisão | 90000 |

A CLI precisa estar instalada e autenticada pelo próprio usuário (`claude auth status`, `codex login status`). O Aurora não lê nem guarda credenciais.

## Garantias

- **O modelo só propõe.** A resposta precisa ser JSON validado por schema, escolher apenas um trabalho do catálogo da instalação e ter texto de até 1200 caracteres. Abrir o trabalho continua passando pela admissão (fila, capacidade, aprovação).
- **Plano B automático.** CLI ausente, tempo esgotado, cota esgotada, JSON inválido, trabalho fora do catálogo ou excesso de chamadas simultâneas: decide por regras, e o motivo aparece na conversa ("por regras: a cota da conta do modelo acabou").
- **Cota protegida.** No máximo 1 chamada por vez e 4 na espera por instalação; o excesso decide por regras na hora.
- **Isolamento.** CLI sem ferramentas, sem sessão persistida, em diretório temporário vazio e com ambiente filtrado (segredos do Aurora não chegam a ela).
- **Instruções separadas dos dados.** O texto do gestor vai como dado em JSON; o prompt de sistema manda ignorar instruções contidas nele.
- **Auditoria sem conteúdo.** Cada resposta grava o evento `chief_decision` (motor, provedor, tempo, tokens, motivo de fallback, trabalho), sem copiar o texto da conversa.

## Verificado

| Verificação | Resultado |
|---|---|
| Testes com CLI falsa (flags, ambiente, timeout, saída grande, cota, formatos) | 11 PASS |
| Serviço e regras | 17 PASS |
| HTTP com servidor real, SQLite e PostgreSQL, incluindo modelo simulado e falha da CLI | 9 PASS em cada |
| Chamada real ao **Claude** (mensagem sintética sem termos do catálogo) | escolheu "Incidente no CRM" corretamente em 6,4 s; 207 tokens de saída |
| Chamada real ao **Codex** | conta sem cota até 13/11/2026; a CLI aceitou as opções e a falha foi classificada como `quota_exhausted`, com as regras respondendo. **A leitura de uma resposta bem-sucedida do Codex ainda não foi verificada.** |

## Pendências

- Verificar uma resposta real do Codex quando a cota voltar.
- Aviso ativo quando o parecer fica pronto (hoje a conversa é relida a cada 3 s).
- Identidade corporativa (hoje operador local ou usuário do piloto).
- Medir custo e latência por decisão em uso contínuo, a partir dos eventos `chief_decision`.
