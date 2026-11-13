/**
 * O que todo conector externo sabe fazer, do mesmo jeito: navegar pelos itens (arquivos, e-mails,
 * canais), trazer um item para o Cérebro e, se tiver escrita, enviar uma entrega aceita.
 *
 * O aplicativo não conhece Google nem Slack: só esta interface. Um conector novo é um adaptador novo.
 */
import type { Json } from "../../../shared/json.ts";

export interface ExternalItem {
  /** Identificador estável no serviço (id do arquivo, do e-mail, do canal). */
  id: string;
  name: string;
  /** `folder` dá para abrir; os outros dá para importar. */
  kind: "folder" | "file" | "email" | "channel";
  /** Rótulo do formato (PDF, Doc, Planilha, E-mail, Canal…). */
  label: string;
  modified_at: string | null;
  size_bytes?: number | null;
  /** Linha extra (remetente do e-mail, número de membros do canal). */
  detail?: string | null;
  /** Se o Cérebro consegue ler este item. */
  importable: boolean;
}

export interface BrowseInput {
  /** Pasta (Drive) ou nada para a raiz. */
  parent?: string;
  /** Busca do serviço (nome do arquivo, busca do Gmail). */
  query?: string;
  cursor?: string;
}

export interface FetchedItem {
  title: string;
  filename: string;
  mediaType: string;
  bytes: Uint8Array;
  /** Muda quando o item muda no serviço; sincronizar compara com a última importada. */
  revision: string;
}

/** Acesso de um adaptador ao segredo da conexão (o token), sem ver o cofre nem o banco. */
export interface Credentials {
  get(): Promise<Record<string, string>>;
  /** Guarda o segredo renovado (token de acesso novo, por exemplo). */
  set(secret: Record<string, string>): Promise<void>;
}

export interface ConnectorAdapter {
  readonly connectorId: string;
  /** Confere a configuração ao conectar (e devolve a versão limpa dela). */
  validate(config: Json, credentials: Credentials): Promise<Json>;
  browse(config: Json, credentials: Credentials, input: BrowseInput): Promise<{ items: ExternalItem[]; cursor: string | null }>;
  fetch(config: Json, credentials: Credentials, itemId: string): Promise<FetchedItem>;
  /** Revisão atual sem baixar o conteúdo (para sincronizar barato). */
  revision(config: Json, credentials: Credentials, itemId: string): Promise<string>;
  /** Envia uma entrega aceita; devolve onde ficou. Só em conectores com escrita. */
  write?(config: Json, credentials: Credentials, file: { filename: string; text: string }): Promise<{ location: string }>;
}
