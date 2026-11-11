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
}

export const CATEGORIES = [
  { id: "files", title: "Arquivos e documentos" },
  { id: "communication", title: "Comunicação" },
  { id: "crm", title: "CRM e vendas" },
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
  { id: "whatsapp", name: "WhatsApp Business", category: "communication", description: "Atendimento e avisos pelo WhatsApp.", capabilities: { read: "Receber mensagens", write: "Enviar mensagens aprovadas" }, available: false, auth: "token" },
  { id: "hubspot", name: "HubSpot", category: "crm", description: "Contatos, negócios e pipeline.", capabilities: { read: "Ler o pipeline", write: "Registrar atividades" }, available: false, auth: "token" },
  { id: "webhook", name: "Webhook", category: "automation", description: "Avisar outro sistema por HTTP quando algo acontece.", capabilities: { write: "Enviar a entrega aceita para uma URL" }, available: false, auth: "none" },
];

export const connectorById = (id: string) => CONNECTORS.find((c) => c.id === id);
