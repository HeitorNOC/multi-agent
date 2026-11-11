/**
 * Google Drive e Gmail, com a conta Google de quem conecta (OAuth com PKCE e acesso offline).
 *
 * - Escopos mínimos: Drive só leitura + arquivos criados pelo Aurora (`drive.file`, para salvar
 *   entregas); Gmail só leitura. O Aurora não apaga nem altera nada no Google.
 * - O token de renovação fica cifrado no cofre; o de acesso (1 hora) é renovado sozinho.
 * - Token revogado na conta Google vira `reauth_required`: a tela pede para reconectar.
 */
import { createHash, randomBytes } from "node:crypto";
import { conflict, invalid, unauthenticated, unavailable } from "../../../shared/errors.ts";
import type { Json } from "../../../shared/json.ts";
import type { BrowseInput, ConnectorAdapter, Credentials, ExternalItem, FetchedItem } from "../domain/adapter.ts";
import type { ExternalHttp } from "./http-client.ts";

export const GOOGLE_SCOPES: Record<"google_drive" | "gmail", string[]> = {
  google_drive: ["https://www.googleapis.com/auth/drive.readonly", "https://www.googleapis.com/auth/drive.file"],
  gmail: ["https://www.googleapis.com/auth/gmail.readonly"],
};

const AUTHORIZE = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN = "https://oauth2.googleapis.com/token";
const DRIVE = "https://www.googleapis.com/drive/v3";
const UPLOAD = "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,webViewLink";
const GMAIL = "https://gmail.googleapis.com/gmail/v1/users/me";

export interface GoogleClientConfig {
  clientId: string;
  clientSecret: string;
}

/** Entrar no Google para uma conexão: URL de consentimento, troca do código e renovação do token. */
export class GoogleOAuth {
  private readonly config: GoogleClientConfig;
  private readonly http: ExternalHttp;
  private readonly now: () => number;

  constructor(config: GoogleClientConfig, http: ExternalHttp, now: () => number = Date.now) {
    this.config = config;
    this.http = http;
    this.now = now;
  }

  start(scopes: readonly string[], redirectUri: string) {
    const verifier = randomBytes(32).toString("base64url");
    const state = randomBytes(24).toString("base64url");
    const url = new URL(AUTHORIZE);
    url.search = new URLSearchParams({
      client_id: this.config.clientId,
      response_type: "code",
      redirect_uri: redirectUri,
      scope: scopes.join(" "),
      state,
      code_challenge: createHash("sha256").update(verifier).digest("base64url"),
      code_challenge_method: "S256",
      // Offline + consentimento: o Google entrega o token de renovação também na segunda vez.
      access_type: "offline",
      prompt: "consent",
      include_granted_scopes: "true",
    }).toString();
    return { url: url.href, state, verifier };
  }

  /** Troca o código pelo segredo da conexão (token de renovação + de acesso). */
  async exchange(code: string, verifier: string, redirectUri: string): Promise<Record<string, string>> {
    const body = await this.token({ grant_type: "authorization_code", code, code_verifier: verifier, redirect_uri: redirectUri });
    if (!body.refresh_token) throw unavailable("google_no_refresh_token", "O Google não liberou acesso contínuo. Remova o acesso do Aurora na sua conta Google e conecte de novo.");
    return { refresh_token: body.refresh_token, ...this.access(body) };
  }

  /** Token de acesso válido; renova (e guarda) quando faltar menos de um minuto. */
  async accessToken(credentials: Credentials): Promise<string> {
    const secret = await credentials.get();
    if (secret.access_token && Number(secret.expires_at) - 60_000 > this.now()) return secret.access_token;
    const body = await this.token({ grant_type: "refresh_token", refresh_token: secret.refresh_token ?? "" });
    const renewed = { ...secret, ...this.access(body) };
    await credentials.set(renewed);
    return renewed.access_token!;
  }

  private access(body: { access_token?: string; expires_in?: number }) {
    if (!body.access_token) throw unavailable("google_token_failed", "O Google não entregou o acesso");
    return { access_token: body.access_token, expires_at: String(this.now() + (body.expires_in ?? 3600) * 1000) };
  }

  private async token(params: Record<string, string>) {
    const { status, body } = await this.http.json<{ access_token?: string; refresh_token?: string; expires_in?: number; error?: string }>(TOKEN, {
      service: "Google",
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ ...params, client_id: this.config.clientId, client_secret: this.config.clientSecret }),
    });
    if (body.error === "invalid_grant") throw unauthenticated("reauth_required", "O acesso ao Google foi revogado ou expirou. Reconecte a conta.");
    if (status >= 400) throw unavailable("google_token_failed", "O Google recusou o acesso desta conexão");
    return body;
  }
}

/** Chamada autenticada; 401 renova uma vez; 403/404 viram mensagens claras. */
async function call<T>(http: ExternalHttp, oauth: GoogleOAuth, credentials: Credentials, url: string, init: RequestInit = {}, raw = false): Promise<T> {
  for (let renew = 0; ; renew++) {
    const token = await oauth.accessToken(credentials);
    const res = await http.request(url, { ...init, service: "Google", headers: { ...(init.headers as Record<string, string>), authorization: `Bearer ${token}` } });
    if (res.status === 401 && renew === 0) {
      await credentials.set({ ...(await credentials.get()), expires_at: "0" });
      continue;
    }
    if (res.status === 401) throw unauthenticated("reauth_required", "O acesso ao Google expirou. Reconecte a conta.");
    if (res.status === 403) throw conflict("google_forbidden", "O Google não permitiu esta ação (sem acesso ao item ou escopo não liberado)");
    if (res.status === 404) throw invalid("external_not_found", "Item não encontrado no Google");
    if (res.status >= 400) throw unavailable("google_failed", `O Google recusou o pedido (${res.status})`);
    if (raw) return res.bytes as T;
    return JSON.parse(new TextDecoder().decode(res.bytes)) as T;
  }
}

// ── Google Drive ─────────────────────────────────────────────────────────────

const GOOGLE_DOC = "application/vnd.google-apps.document";
const GOOGLE_SHEET = "application/vnd.google-apps.spreadsheet";
const GOOGLE_SLIDES = "application/vnd.google-apps.presentation";
const FOLDER = "application/vnd.google-apps.folder";
const DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
/** Arquivos do Google viram formatos que o Cérebro lê; o resto é baixado como está. */
const EXPORT: Record<string, { mediaType: string; ext: string; label: string }> = {
  [GOOGLE_DOC]: { mediaType: DOCX, ext: "docx", label: "Doc" },
  [GOOGLE_SHEET]: { mediaType: "text/csv", ext: "csv", label: "Planilha" },
  [GOOGLE_SLIDES]: { mediaType: "text/plain", ext: "txt", label: "Apresentação" },
};
const DIRECT: Record<string, string> = {
  "application/pdf": "PDF",
  [DOCX]: "Word",
  "text/plain": "TXT",
  "text/markdown": "MD",
  "text/csv": "CSV",
  "application/json": "JSON",
  "image/png": "PNG",
  "image/jpeg": "JPG",
  "image/webp": "WEBP",
};

interface DriveFile {
  id: string;
  name: string;
  mimeType: string;
  modifiedTime?: string;
  size?: string;
  version?: string;
  md5Checksum?: string;
}

const driveQuote = (s: string) => s.replace(/\\/g, "\\\\").replace(/'/g, "\\'");

export class GoogleDriveAdapter implements ConnectorAdapter {
  readonly connectorId = "google_drive";
  private readonly http: ExternalHttp;
  private readonly oauth: GoogleOAuth;

  constructor(http: ExternalHttp, oauth: GoogleOAuth) {
    this.http = http;
    this.oauth = oauth;
  }

  async validate(config: Json, credentials: Credentials) {
    await call(this.http, this.oauth, credentials, `${DRIVE}/about?fields=user(emailAddress)`);
    const folder = (config as { folder_id?: unknown } | null)?.folder_id;
    if (folder !== undefined && folder !== null && (typeof folder !== "string" || !/^[\w-]{1,200}$/.test(folder)))
      throw invalid("invalid_folder", "Pasta do Drive inválida");
    return { ...(typeof folder === "string" ? { folder_id: folder } : {}) } as Json;
  }

  async browse(_config: Json, credentials: Credentials, input: BrowseInput) {
    const q = input.query?.trim()
      ? `name contains '${driveQuote(input.query.trim())}' and trashed = false`
      : `'${driveQuote(input.parent ?? "root")}' in parents and trashed = false`;
    const params = new URLSearchParams({
      q,
      pageSize: "50",
      orderBy: "folder,modifiedTime desc",
      fields: "nextPageToken,files(id,name,mimeType,modifiedTime,size)",
      supportsAllDrives: "true",
      includeItemsFromAllDrives: "true",
      ...(input.cursor ? { pageToken: input.cursor } : {}),
    });
    const body = await call<{ files?: DriveFile[]; nextPageToken?: string }>(this.http, this.oauth, credentials, `${DRIVE}/files?${params}`);
    const items: ExternalItem[] = (body.files ?? []).map((f) => {
      const folder = f.mimeType === FOLDER;
      const label = folder ? "Pasta" : (EXPORT[f.mimeType]?.label ?? DIRECT[f.mimeType] ?? "Outro");
      return {
        id: f.id,
        name: f.name,
        kind: folder ? "folder" : "file",
        label,
        modified_at: f.modifiedTime ?? null,
        size_bytes: f.size ? Number(f.size) : null,
        importable: !folder && (!!EXPORT[f.mimeType] || !!DIRECT[f.mimeType]),
      };
    });
    return { items, cursor: body.nextPageToken ?? null };
  }

  private meta(credentials: Credentials, id: string) {
    return call<DriveFile>(this.http, this.oauth, credentials, `${DRIVE}/files/${encodeURIComponent(id)}?fields=id,name,mimeType,modifiedTime,version,md5Checksum&supportsAllDrives=true`);
  }

  async revision(_config: Json, credentials: Credentials, id: string) {
    const f = await this.meta(credentials, id);
    return f.version ?? f.md5Checksum ?? f.modifiedTime ?? "";
  }

  async fetch(_config: Json, credentials: Credentials, id: string): Promise<FetchedItem> {
    const f = await this.meta(credentials, id);
    const exported = EXPORT[f.mimeType];
    const base = f.name.replace(/\.[^.]+$/, "");
    if (exported) {
      const bytes = await call<Uint8Array>(this.http, this.oauth, credentials, `${DRIVE}/files/${encodeURIComponent(id)}/export?mimeType=${encodeURIComponent(exported.mediaType)}`, {}, true);
      return { title: f.name, filename: `${base}.${exported.ext}`, mediaType: exported.mediaType, bytes, revision: f.version ?? f.modifiedTime ?? "" };
    }
    if (!DIRECT[f.mimeType]) throw invalid("unsupported_media_type", `O Cérebro não lê este tipo de arquivo (${f.mimeType})`);
    const bytes = await call<Uint8Array>(this.http, this.oauth, credentials, `${DRIVE}/files/${encodeURIComponent(id)}?alt=media&supportsAllDrives=true`, {}, true);
    return { title: base, filename: f.name, mediaType: f.mimeType, bytes, revision: f.version ?? f.md5Checksum ?? f.modifiedTime ?? "" };
  }

  /** Cria um arquivo Markdown novo (nunca sobrescreve) na pasta configurada ou na raiz. */
  async write(config: Json, credentials: Credentials, file: { filename: string; text: string }) {
    const folder = (config as { folder_id?: string }).folder_id;
    const boundary = `aurora-${randomBytes(8).toString("hex")}`;
    const metadata = { name: file.filename, mimeType: "text/markdown", ...(folder ? { parents: [folder] } : {}) };
    const body = [`--${boundary}`, "Content-Type: application/json; charset=UTF-8", "", JSON.stringify(metadata), `--${boundary}`, "Content-Type: text/markdown; charset=UTF-8", "", file.text, `--${boundary}--`, ""].join("\r\n");
    const created = await call<{ id: string; webViewLink?: string }>(this.http, this.oauth, credentials, `${UPLOAD}&supportsAllDrives=true`, {
      method: "POST",
      headers: { "content-type": `multipart/related; boundary=${boundary}` },
      body,
    });
    return { location: created.webViewLink ?? `drive:${created.id}` };
  }
}

// ── Gmail ────────────────────────────────────────────────────────────────────

interface GmailPart {
  mimeType?: string;
  filename?: string;
  body?: { data?: string };
  parts?: GmailPart[];
  headers?: { name: string; value: string }[];
}
interface GmailMessage {
  id: string;
  historyId?: string;
  internalDate?: string;
  snippet?: string;
  payload?: GmailPart;
}

const header = (m: GmailMessage, name: string) => m.payload?.headers?.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value ?? "";
const decode = (data?: string) => (data ? Buffer.from(data, "base64url").toString("utf8") : "");
const MAX_PARALLEL = 5;

/** O texto do e-mail: a parte texto puro; sem ela, o HTML sem marcas. */
export function emailText(part: GmailPart | undefined): string {
  const plain: string[] = [];
  const html: string[] = [];
  const walk = (p?: GmailPart) => {
    if (!p) return;
    if (p.filename) return; // anexos ficam fora (podem ser importados à parte no futuro)
    if (p.mimeType === "text/plain") plain.push(decode(p.body?.data));
    else if (p.mimeType === "text/html") html.push(decode(p.body?.data));
    p.parts?.forEach(walk);
  };
  walk(part);
  if (plain.join("").trim()) return plain.join("\n\n");
  return html
    .join("\n\n")
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, "")
    .replace(/<br\s*\/?>|<\/p>|<\/div>|<\/li>|<\/tr>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

export class GmailAdapter implements ConnectorAdapter {
  readonly connectorId = "gmail";
  private readonly http: ExternalHttp;
  private readonly oauth: GoogleOAuth;

  constructor(http: ExternalHttp, oauth: GoogleOAuth) {
    this.http = http;
    this.oauth = oauth;
  }

  async validate(_config: Json, credentials: Credentials) {
    await call(this.http, this.oauth, credentials, `${GMAIL}/profile`);
    return {} as Json;
  }

  async browse(_config: Json, credentials: Credentials, input: BrowseInput) {
    const params = new URLSearchParams({ maxResults: "20", q: input.query?.trim() || "in:inbox", ...(input.cursor ? { pageToken: input.cursor } : {}) });
    const list = await call<{ messages?: { id: string }[]; nextPageToken?: string }>(this.http, this.oauth, credentials, `${GMAIL}/messages?${params}`);
    const ids = (list.messages ?? []).map((m) => m.id);
    const metas: GmailMessage[] = [];
    // Metadados em paralelo, poucos por vez (o Gmail limita chamadas por segundo).
    for (let i = 0; i < ids.length; i += MAX_PARALLEL)
      metas.push(
        ...(await Promise.all(
          ids.slice(i, i + MAX_PARALLEL).map((id) =>
            call<GmailMessage>(this.http, this.oauth, credentials, `${GMAIL}/messages/${id}?format=metadata&metadataHeaders=Subject&metadataHeaders=From&metadataHeaders=Date`),
          ),
        )),
      );
    const items: ExternalItem[] = metas.map((m) => ({
      id: m.id,
      name: header(m, "Subject") || "(sem assunto)",
      kind: "email",
      label: "E-mail",
      modified_at: m.internalDate ? new Date(Number(m.internalDate)).toISOString() : null,
      detail: header(m, "From"),
      importable: true,
    }));
    return { items, cursor: list.nextPageToken ?? null };
  }

  async revision(_config: Json, credentials: Credentials, id: string) {
    // E-mail não muda depois de recebido.
    const m = await call<GmailMessage>(this.http, this.oauth, credentials, `${GMAIL}/messages/${id}?format=minimal`);
    return m.internalDate ?? m.id;
  }

  async fetch(_config: Json, credentials: Credentials, id: string): Promise<FetchedItem> {
    const m = await call<GmailMessage>(this.http, this.oauth, credentials, `${GMAIL}/messages/${id}?format=full`);
    const subject = header(m, "Subject") || "(sem assunto)";
    const date = m.internalDate ? new Date(Number(m.internalDate)).toISOString() : header(m, "Date");
    const body = emailText(m.payload).trim() || m.snippet || "";
    const text = [`# ${subject}`, `- De: ${header(m, "From")}`, `- Para: ${header(m, "To")}`, `- Data: ${date}`, "", body].join("\n");
    const name = subject.replace(/[\\/:*?"<>|]+/g, " ").slice(0, 80).trim() || "email";
    return { title: subject, filename: `${name}.md`, mediaType: "text/markdown", bytes: new TextEncoder().encode(text), revision: m.internalDate ?? m.id };
  }
}
