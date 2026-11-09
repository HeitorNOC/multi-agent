# Central humana de recuperação

Integração da API e da interface do MVP com o protocolo empresarial de recuperação já qualificado. A central permite listar e selecionar casos, inspecionar a evidência atual, registrar a primeira revisão, confirmar com outra identidade e consultar um envio cuja resposta se perdeu. LangGraph continua sendo o único owner de workflow.

## Abrir o perfil operacional

```powershell
.\validation\human-recovery\Start-Central.ps1
```

Sessão disponibilizada nesta entrega: http://127.0.0.1:61621 . O endereço é local e pode mudar em outra inicialização. O perfil usa PostgreSQL/processos/protocolo reais e um provedor controlado, **sem chamadas de modelo**. Não substitui nem aprova as propostas Aurora já existentes na sessão de análise.

O inicializador prepara dois casos fictícios pendentes: uma leitura com recibo conhecido após queda no commit e uma inferência sem resultado conhecido. A segunda aguarda a recuperação da operação anterior. Nenhuma revisão desses dois casos de demonstração foi registrada automaticamente no ambiente deixado disponível.

## Credenciais e revisão manual

O log privado `.state/launcher.log` informa o caminho de `recovery-reviewers.json`. O apontador `.state/active.json` também contém esse caminho no campo `reviewers_file`. Os valores das credenciais não fazem parte dos relatórios públicos.

```powershell
$central = Get-Content validation/human-recovery/.state/active.json | ConvertFrom-Json
Get-Content -LiteralPath $central.reviewers_file
```

Use a credencial de desenvolvimento da primeira conta na página local. Inspecione **Leitura interrompida**, escreva uma justificativa de 20 a 500 caracteres e registre a revisão. A mesma identidade não poderá confirmá-la. Saia e entre com a outra credencial, ou use uma sessão de navegador separada, para inspecionar e confirmar.

Depois, a inferência desconhecida fica elegível. Seu encerramento preserva a reserva e não inventa resultado nem repete inferência. Os controles de revisão são os mesmos. O histórico distingue leitura conciliada de encerramento desconhecido.

Essas contas comprovam separação lógica entre identidades de teste, não duas pessoas reais ou SSO empresarial. As decisões são validadas no servidor. Nenhum seletor de nome, campo enviado pelo navegador ou texto do modelo concede o papel de revisor.

Para encerrar somente esse ambiente e seus recursos verificados:

```powershell
.\validation\human-recovery\Stop-Central.ps1
```

## Integração na aplicação

- `demo/recovery.ts`: sessões locais opacas, comandos persistidos, ID vinculado a ator/conteúdo, deduplicação concorrente, reconciliação de envio e projeção sem resultado semântico bruto.
- `demo/server.ts`: rotas `/api/recovery/*` e página `/recovery`; eventos e journal compartilham o banco da API.
- `demo/recovery_bridge.py`: ponte allowlisted para `recovery_queue`, `recovery_inspect`, `recovery_propose` e `recovery_confirm`.
- `demo-enterprise/RecoveryCenter.tsx`: componente inserido no Aurora e reutilizado pelo perfil operacional.
- `demo-enterprise/start.py`: provisiona as identidades antes do inventário assinado e conecta a ponte no próximo bootstrap. A ponte tem segredo separado daquele fornecido aos workers e pode ser consultada mesmo sem o RAG estar pronto, se o serviço de recuperação estiver acessível.
- `validation/langgraph-retained-flow/recovery_queue.ts`: fila somente de leitura, seleção explícita e histórico autorizado. Um backup antigo bloqueia a lista; não produz um falso “nenhuma pendência”.

A sessão Aurora de análise que já estava em execução preserva o servidor carregado anteriormente. Esta entrega não a reiniciou, não reingeriu seus documentos e não aprovou suas propostas. O código novo da central fica conectado no bootstrap atualizado; o perfil operacional acima permite usá-lo agora sem consumir modelos.

## Escopo que permanece aberto

A central cobre operações registradas no protocolo empresarial conectado. Os slots `model-slots.sqlite` usados pelas chamadas diretas de planejamento/especialistas da demo não foram migrados automaticamente para esse protocolo. Recuperar desconhecidos dessa categoria exige vinculá-los à admissão/recibo estáveis correspondentes, com qualificação própria.

Ainda faltam SSO/ACL corporativas, TLS, gestão operacional de segredos, migração empresarial PostgreSQL, carga/DR/custos comerciais e integração dos demais tipos de trabalho. O uso de credenciais de desenvolvimento continua limitado ao loopback e ao corpus fictício. Produção permanece NO-GO.

[Resultados e limitações](RESULTS.md) · [comandos e evidências](COMMANDS.md).
