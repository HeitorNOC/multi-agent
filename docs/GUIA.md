# Guia do Aurora

Uma explicação sem jargão: o que é o Aurora, como ele pensa e como usar no dia a dia. A parte
técnica está em [Arquitetura e fluxos](ARQUITETURA.md).

## O que é

Pense no Aurora como uma equipe de especialistas que trabalha para a sua empresa, dentro do seu
computador. Você conversa com um coordenador, o **Chief of Staff**. Ele entende o pedido, chama
as pessoas certas do time, junta o que cada uma descobriu e traz uma recomendação para você
decidir.

Os especialistas são **agentes de IA** com papéis claros: a analista de compras, o gestor de
tráfego, a contadora, o copywriter. Você escolhe quem entra no time, como numa contratação.

## As três regras do Aurora

1. **Só fala do que está escrito.** Os agentes respondem a partir dos documentos da empresa, o
   **Cérebro**. Toda afirmação vem com a fonte. Se não há documento sobre o assunto, eles dizem
   que não encontraram, em vez de inventar.
2. **Nada sai sem você aprovar.** O trabalho para antes de qualquer ação e mostra o parecer. Você
   aprova exatamente aquele parecer; se algo mudar, precisa aprovar de novo.
3. **Nada acontece duas vezes por engano.** Se o computador desligar no meio, o Aurora continua de
   onde parou. Se ele não tiver certeza se algo já foi feito, ele não repete por conta própria: põe
   o caso na Governança para uma pessoa decidir.

## As telas

| Tela | Para quê |
| --- | --- |
| **Command Center** | O resumo do dia: o que espera a sua decisão, o que está andando, o que deu problema e o uso do modelo |
| **Conversa** | Falar com o Chief of Staff. Peça algo como "avalie as compras acima de 10 mil este mês". Para pedidos maiores ("quero implementar o módulo de WebChat"), com o modelo ligado, ele planeja com você: pergunta o que falta, mostra o plano (etapas, responsáveis, quem traz do catálogo, riscos e fontes) e só começa quando você aprova. Para ajustar, é só escrever |
| **Estação** | Falar direto com um agente, sem abrir um trabalho. Bom para tirar uma dúvida rápida |
| **Trabalhos** | Cada pedido em andamento: plano, o que cada agente achou (ou, num plano aprovado, cada etapa com a entrega e a revisão), o que precisa da sua decisão, citações e o botão de aprovar |
| **Entregas** | O resultado aprovado, com versões. Você aceita ou pede ajustes |
| **Rotinas** | Pedidos que se repetem sozinhos, como um relatório toda segunda às 9h |
| **Cérebro** | Os documentos da empresa: enviar, atualizar, revogar, perguntar. Em **Lista** ou em **Mapa 3D** |
| **Agentes** | O seu time em três vistas: **Lista** (o que cada agente está fazendo agora, em qual trabalho, marcos e tempo), **Mapa 3D** e **Organograma** (cartões ligados por setas, na horizontal ou na vertical). E o catálogo de especialistas para contratar |
| **Jarvis** | O Chief of Staff como seu assistente, num centro de comando em 3D. Fale ("Jarvis, o que espera minha aprovação?"), aperte espaço ou escreva; ele responde em voz alta (Chrome ou Edge) e você pode interromper falando. Mostra a hora, os sistemas e o que espera você; quem ele aciona acende no mapa. Dá para pôr em tela cheia |
| **Integrações** | Ligar o Aurora às ferramentas da empresa: pasta, Drive, Gmail, Slack, banco de dados somente leitura, GitHub (lê o código e abre pull requests), WhatsApp Business e Página do Facebook (enviam entregas aceitas). E os **recursos da empresa** (bancos, filas, ambientes) que o Chief usa para planejar |
| **Governança** | Casos que precisam de uma decisão humana e a trilha do que aconteceu |
| **Configurações** | Empresa, **alçadas do Chief of Staff** (se ele pode trazer agentes que faltam: nunca, propondo para você aprovar ou sozinho; se entram só para o trabalho; quantos por trabalho e em quais áreas), quem tem acesso e como os agentes rodam |

## Primeiros passos

1. **Abra o Aurora.** Por padrão ele roda sem login, só para você, no seu computador. (Com
   `AURORA_AUTH=accounts`, cada pessoa entra com a própria conta.)
2. **Conte sobre a empresa.** Em "Montar sua empresa": nome, setor, objetivos e políticas.
3. **Alimente o Cérebro.** Envie os documentos que importam (PDF, Word, TXT, Markdown, CSV ou
   JSON) ou escreva o texto direto, e escolha a área de cada um. Quanto melhores e mais
   organizados os documentos, melhores as respostas.
4. **Monte o time.** Em Agentes, contrate os especialistas de que precisa. São 69 em 11 áreas:
   gestão, marketing (copy, Instagram, tráfego pago, design, SEO, e-mail, vídeo, marca),
   vendas, atendimento, e-commerce e loja, operações, finanças, pessoas, jurídico, produto e
   tecnologia. Dá também para criar um agente do zero.
5. **Peça algo na Conversa** e acompanhe em Trabalhos. Quando o parecer chegar, leia, confira as
   fontes e aprove ou recuse.

## Quem vê o quê

- **Documentos abertos** valem para toda a empresa e para todos os agentes.
- **Documentos restritos** só aparecem para as pessoas listadas (pelo e-mail com que entram no
  Aurora) e para os agentes que você marcar. Exemplo: o contrato de um fornecedor pode ficar
  visível só para você e para o Bruno, de compras.
- **Na Estação**, o agente só usa o que ele **e** você podem ler. Ele nunca mostra a alguém um
  documento que estava fechado para essa pessoa.

## Acesso de outras pessoas

Em **Configurações › Acesso**, o dono libera o e-mail de alguém. A pessoa entra com Google ou
Microsoft usando esse e-mail, ou escolhe "Criar conta" e define uma senha. O Aurora não manda
e-mail: avise você mesmo. O dono pode suspender um acesso a qualquer momento; a pessoa sai na hora.

Para os botões de Google e Microsoft aparecerem, alguém de TI precisa criar o "aplicativo" de
login nessas contas e informar os códigos ao subir o Aurora. A tela de Configurações mostra o
endereço que precisa ser cadastrado. Os detalhes estão no [README](../README.md#acesso).

## Quanto custa usar

Nesta fase, os agentes rodam com a sua assinatura do **Claude Code** ou do **Codex**, aberta neste
computador. O uso entra no limite da sua assinatura e o Aurora não cobra nada por chamada. Mais
para frente, vai dar para conectar uma chave de API e pagar pelo uso.

## Perguntas frequentes

**O agente disse que não encontrou nada. E agora?**
Ele não achou um documento que responda. Envie o documento ao Cérebro (ou dê acesso a ele) e
pergunte de novo.

**Atualizei uma política. O Aurora vai usar a antiga?**
Não. Envie como nova versão (ou marque que ela substitui a anterior). A partir da data de
vigência, só a nova vale.

**O computador desligou no meio de um trabalho.**
Ao ligar de novo, o trabalho continua do último passo concluído. Se houver dúvida se algo já foi
feito, o caso aparece na Governança para você decidir.

**Os meus documentos vão para algum lugar?**
Eles ficam no banco do Aurora, no seu computador. Os trechos usados numa resposta vão para o
modelo de IA pela CLI do Claude Code ou do Codex, com a sua conta, como quando você usa essas
ferramentas diretamente.

**Preciso de login?**
Não, por padrão. Tudo fica no nome do "operador local". Para várias pessoas, suba com
`AURORA_AUTH=accounts`.
