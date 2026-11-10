/**
 * Catálogo de conectores por categoria. Cada conector declara o que sabe fazer (`read`, `write`);
 * a conexão da empresa diz o que está autorizado. Uma ação fora do autorizado é recusada e fica
 * registrada.
 *
 * Disponível hoje: **pasta local** — não exige credencial (o Aurora nunca guarda senhas). Os
 * conectores que dependem de login numa conta externa aparecem como "em breve".
 */
export type Capability = "read" | "write";

export interface ConnectorDefinition {
  readonly id: string;
  readonly name: string;
  readonly category: string;
  readonly description: string;
  /** O que cada capacidade faz neste conector, em palavras do gestor. */
  readonly capabilities: Partial<Record<Capability, string>>;
  readonly available: boolean;
}

export const CATEGORIES = [
  { id: "files", title: "Arquivos e documentos" },
  { id: "communication", title: "Comunicação" },
  { id: "crm", title: "CRM e vendas" },
  { id: "automation", title: "Automação" },
] as const;

export const CONNECTORS: readonly ConnectorDefinition[] = [
  {
    id: "local_folder",
    name: "Pasta local",
    category: "files",
    description: "Uma pasta deste computador (também serve uma pasta sincronizada do OneDrive, Google Drive ou Dropbox).",
    capabilities: { read: "Ler documentos da pasta para o Cérebro", write: "Salvar entregas aceitas na pasta" },
    available: true,
  },
  { id: "google_drive", name: "Google Drive", category: "files", description: "Documentos e planilhas do Google Workspace.", capabilities: { read: "Ler documentos", write: "Salvar entregas" }, available: false },
  { id: "sharepoint", name: "SharePoint / OneDrive", category: "files", description: "Bibliotecas de documentos do Microsoft 365.", capabilities: { read: "Ler documentos", write: "Salvar entregas" }, available: false },
  { id: "slack", name: "Slack", category: "communication", description: "Avisos e entregas em canais.", capabilities: { write: "Publicar entregas aceitas num canal" }, available: false },
  { id: "gmail", name: "Gmail", category: "communication", description: "Enviar entregas por e-mail.", capabilities: { write: "Enviar entregas aceitas" }, available: false },
  { id: "whatsapp", name: "WhatsApp Business", category: "communication", description: "Atendimento e avisos pelo WhatsApp.", capabilities: { read: "Receber mensagens", write: "Enviar mensagens aprovadas" }, available: false },
  { id: "hubspot", name: "HubSpot", category: "crm", description: "Contatos, negócios e pipeline.", capabilities: { read: "Ler o pipeline", write: "Registrar atividades" }, available: false },
  { id: "webhook", name: "Webhook", category: "automation", description: "Avisar outro sistema por HTTP quando algo acontece.", capabilities: { write: "Enviar a entrega aceita para uma URL" }, available: false },
];

export const connectorById = (id: string) => CONNECTORS.find((c) => c.id === id);
