/**
 * Catálogo de conectores por categoria. Cada conector declara o que sabe fazer (`read`, `write`) e
 * como se autentica; a conexão da empresa diz o que está autorizado. Uma ação fora do autorizado
 * é recusada e fica registrada.
 *
 * - `none`: pasta local, sem credencial.
 * - `google`: login na conta Google (OAuth); o Aurora guarda só o token de renovação, cifrado.
 * - `token`: token de um app criado pela empresa (Slack), cifrado no cofre.
 */
export type Capability = "read" | "write";
export type ConnectorAuth = "none" | "google" | "token";

export interface ConnectorDefinition {
  readonly id: string;
  readonly name: string;
  readonly category: string;
  readonly description: string;
  /** O que cada capacidade faz neste conector, em palavras do gestor. */
  readonly capabilities: Partial<Record<Capability, string>>;
  readonly available: boolean;
  readonly auth: ConnectorAuth;
  /** Passo a passo para criar o acesso (mostrado na tela de conectar). */
  readonly setup?: readonly string[];
  /** Campos da configuração que a tela de conectar pede (além do token). */
  readonly fields?: readonly { key: string; label: string; placeholder?: string; hint?: string; required?: boolean }[];
  /** Como chamar o segredo na tela (ex.: "Token de acesso"). */
  readonly secretLabel?: string;
  readonly secretPlaceholder?: string;
}

export const CATEGORIES = [
  { id: "files", title: "Arquivos e documentos" },
  { id: "communication", title: "Comunicação" },
  { id: "crm", title: "CRM e vendas" },
  { id: "data", title: "Dados" },
  { id: "engineering", title: "Engenharia" },
  { id: "automation", title: "Automação" },
] as const;

const GOOGLE_SETUP = [
  "No Google Cloud Console, crie um projeto e ative as APIs do Google Drive e do Gmail.",
  "Em Tela de consentimento OAuth, escolha o tipo Externo, deixe em Teste e adicione o seu e-mail como usuário de teste.",
  "Em Credenciais, crie um ID do cliente OAuth do tipo Aplicativo da Web com o endereço de retorno mostrado nesta tela.",
  "Suba o Aurora com AURORA_GOOGLE_CLIENT_ID e AURORA_GOOGLE_CLIENT_SECRET.",
];

export const CONNECTORS: readonly ConnectorDefinition[] = [
  {
    id: "local_folder",
    name: "Pasta local",
    category: "files",
    description: "Uma pasta deste computador (também serve uma pasta sincronizada do OneDrive, Google Drive ou Dropbox).",
    capabilities: { read: "Ler documentos da pasta para o Cérebro", write: "Salvar entregas aceitas na pasta" },
    available: true,
    auth: "none",
  },
  {
    id: "google_drive",
    name: "Google Drive",
    category: "files",
    description: "Documentos, planilhas, apresentações e PDFs do seu Drive.",
    capabilities: { read: "Ler arquivos para o Cérebro e manter atualizados", write: "Salvar entregas aceitas como arquivo novo" },
    available: true,
    auth: "google",
    setup: GOOGLE_SETUP,
  },
  { id: "sharepoint", name: "SharePoint / OneDrive", category: "files", description: "Bibliotecas de documentos do Microsoft 365.", capabilities: { read: "Ler documentos", write: "Salvar entregas" }, available: false, auth: "token" },
  {
    id: "slack",
    name: "Slack",
    category: "communication",
    description: "Conversas dos canais para o Cérebro e entregas publicadas num canal.",
    capabilities: { read: "Ler mensagens dos canais em que o app está", write: "Publicar entregas aceitas num canal" },
    available: true,
    auth: "token",
    setup: [
      "Em api.slack.com/apps, crie um app (From scratch) no seu workspace.",
      "Em OAuth & Permissions, adicione os escopos de bot: channels:read, channels:history, groups:read, groups:history, users:read e chat:write.",
      "Instale o app no workspace e copie o Bot User OAuth Token (começa com xoxb-).",
      "No Slack, convide o app para cada canal que o Aurora deve ler (/invite @nome-do-app).",
    ],
  },
  {
    id: "gmail",
    name: "Gmail",
    category: "communication",
    description: "E-mails importantes para o Cérebro (só leitura).",
    capabilities: { read: "Ler e-mails escolhidos para o Cérebro" },
    available: true,
    auth: "google",
    setup: GOOGLE_SETUP,
  },
  {
    id: "postgres_readonly",
    name: "Banco de dados (somente leitura)",
    category: "data",
    description: "Tabelas de um PostgreSQL (uma réplica, por exemplo) para o Cérebro, com totais e médias calculados. Nunca escreve.",
    capabilities: { read: "Trazer tabelas liberadas para o Cérebro" },
    available: true,
    auth: "token",
    setup: [
      "No banco (de preferência uma réplica), crie um usuário só para o Aurora: CREATE ROLE aurora_leitura LOGIN PASSWORD '…';",
      "Dê acesso só de leitura ao que pode ser lido: GRANT USAGE ON SCHEMA vendas TO aurora_leitura; GRANT SELECT ON vendas.avaliacoes TO aurora_leitura;",
      "Cole a URL de conexão desse usuário: postgres://aurora_leitura:senha@host:5432/banco",
      "Opcional: liste as tabelas liberadas (esquema.tabela). O Aurora só lê dentro de transações somente leitura, até 5.000 linhas por tabela.",
    ],
  },
  {
    id: "whatsapp",
    name: "WhatsApp Business",
    category: "communication",
    description: "Envia entregas aceitas como mensagem do WhatsApp Business (Cloud API da Meta).",
    capabilities: { write: "Enviar a entrega aceita como mensagem" },
    available: true,
    auth: "token",
    secretLabel: "Token de acesso da Cloud API",
    secretPlaceholder: "EAAG…",
    fields: [
      { key: "phone_number_id", label: "Phone number ID", placeholder: "123456789012345", required: true, hint: "Em developers.facebook.com › seu app › WhatsApp › Configuração da API." },
      { key: "to", label: "Número que recebe", placeholder: "5511999990000", required: true, hint: "Com DDI e DDD, só números." },
    ],
    setup: [
      "Precisa de uma conta do WhatsApp Business na plataforma da Meta, com o número verificado.",
      "Crie um app em developers.facebook.com, adicione o produto WhatsApp e gere um token de acesso permanente (usuário do sistema).",
      "Mensagens livres só chegam a quem falou com a empresa nas últimas 24 horas; fora disso, a Meta exige modelos aprovados.",
    ],
  },
  {
    id: "facebook_page",
    name: "Página do Facebook",
    category: "communication",
    description: "Publica entregas aceitas como post da página da empresa.",
    capabilities: { write: "Publicar a entrega aceita como post" },
    available: true,
    auth: "token",
    secretLabel: "Token de acesso da página",
    secretPlaceholder: "EAAG…",
    fields: [{ key: "page_id", label: "ID da página", placeholder: "998877665544", required: true }],
    setup: [
      "Em developers.facebook.com, crie um app com a permissão pages_manage_posts aprovada.",
      "Gere um token de acesso da página (não do usuário) e cole aqui; o ID da página fica em Sobre › Transparência da página.",
    ],
  },
  {
    id: "github",
    name: "GitHub",
    category: "engineering",
    description: "Lê o código de um repositório para o Cérebro e abre pull requests com o que o time de TI entregou. Nunca faz merge.",
    capabilities: { read: "Trazer arquivos do repositório para o Cérebro", write: "Abrir pull request com a entrega aceita" },
    available: true,
    auth: "token",
    secretLabel: "Token de acesso (fine-grained)",
    secretPlaceholder: "github_pat_…",
    fields: [
      { key: "repository", label: "Repositório", placeholder: "empresa/servico-webchat", required: true },
      { key: "base", label: "Branch base (opcional)", placeholder: "main" },
    ],
    setup: [
      "Em github.com › Settings › Developer settings › Fine-grained tokens, crie um token só para este repositório.",
      "Permissões: Contents (leitura e escrita) e Pull requests (leitura e escrita).",
      "O Aurora abre um pull request por entrega aceita; o merge é sempre seu, e o CI do repositório roda os testes.",
    ],
  },
  { id: "hubspot", name: "HubSpot", category: "crm", description: "Contatos, negócios e pipeline.", capabilities: { read: "Ler o pipeline", write: "Registrar atividades" }, available: false, auth: "token" },
  { id: "webhook", name: "Webhook", category: "automation", description: "Avisar outro sistema por HTTP quando algo acontece.", capabilities: { write: "Enviar a entrega aceita para uma URL" }, available: false, auth: "none" },
];

export const connectorById = (id: string) => CONNECTORS.find((c) => c.id === id);
