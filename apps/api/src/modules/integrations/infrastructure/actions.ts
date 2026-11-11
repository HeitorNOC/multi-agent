/**
 * Conectores de ação (N6): o que o time produz sai da empresa por eles, sempre por uma entrega
 * ACEITA pelo CEO e com o clique dele em "Salvar em" / "Enviar" (o conteúdo exato que vai sair).
 *
 * - GitHub: lê um repositório para o Cérebro (os projetos existentes que o Chief consulta ao
 *   planejar) e abre um pull request com a entrega e os arquivos de código que os agentes
 *   produziram (blocos ```linguagem caminho=src/arquivo.ts```). Nunca faz merge: o merge é do CEO
 *   no GitHub, e o CI do repositório roda os testes no pull request.
 * - WhatsApp Business (Cloud API): envia a entrega como mensagem para o número configurado.
 * - Página do Facebook: publica a entrega como post da página.
 *
 * Tokens no cofre, vistos só aqui por `Credentials`.
 */
import { conflict, invalid, unauthenticated, unavailable } from "../../../shared/errors.ts";
import type { Json } from "../../../shared/json.ts";
import type { BrowseInput, ConnectorAdapter, Credentials, ExternalItem, FetchedItem } from "../domain/adapter.ts";
import type { ExternalHttp } from "./http-client.ts";

const json = (bytes: Uint8Array) => JSON.parse(new TextDecoder().decode(bytes) || "null");
const token = async (c: Credentials) => {
  const t = (await c.get()).token;
  if (!t) throw unauthenticated("token_missing", "Token ausente; conecte de novo");
  return t;
};

/** Arquivos de código num texto: blocos cercados com `caminho=` (ou `path=`) na linha de abertura. */
export function extractFiles(text: string): { path: string; content: string }[] {
  const files = new Map<string, string>();
  const fence = /```[^\n]*?\b(?:caminho|path)=([^\s`]+)[^\n]*\n([\s\S]*?)```/g;
  for (let m = fence.exec(text); m; m = fence.exec(text)) {
    const path = m[1]!.replace(/^\.?\//, "");
    // Caminho relativo, sem subir de pasta nem mexer na configuração do repositório.
    if (!/^[\w.\-/]+$/.test(path) || path.split("/").some((p) => p === ".." || p === "") || path.startsWith(".git/")) continue;
    files.set(path, m[2]!);
  }
  return [...files].map(([path, content]) => ({ path, content }));
}

const slug = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "entrega";

// ── GitHub ─────────────────────────────────────────────────────────────────────

const REPO = /^[\w.-]+\/[\w.-]+$/;

export class GitHubAdapter implements ConnectorAdapter {
  readonly connectorId = "github";
  private readonly http: ExternalHttp;
  private readonly now: () => Date;
  constructor(http: ExternalHttp, now: () => Date = () => new Date()) {
    this.http = http;
    this.now = now;
  }

  private async api<T>(credentials: Credentials, method: string, path: string, body?: unknown): Promise<T> {
    const r = await this.http.request(`https://api.github.com${path}`, {
      service: "GitHub",
      method,
      headers: { authorization: `Bearer ${await token(credentials)}`, accept: "application/vnd.github+json", "x-github-api-version": "2022-11-28", "content-type": "application/json", "user-agent": "aurora" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    if (r.status === 401) throw unauthenticated("reauth_required", "O GitHub recusou o token; gere outro e reconecte");
    if (r.status === 403 || r.status === 404) throw conflict("github_forbidden", "O token não tem acesso a este repositório (precisa de Contents e Pull requests)");
    if (r.status >= 400) throw unavailable("github_error", `O GitHub respondeu ${r.status}`);
    return json(r.bytes) as T;
  }

  private config(raw: Json) {
    const c = (raw ?? {}) as { repository?: unknown; base?: unknown };
    if (typeof c.repository !== "string" || !REPO.test(c.repository)) throw invalid("invalid_repository", "Repositório no formato dono/nome");
    return { repository: c.repository, base: typeof c.base === "string" && c.base ? c.base : null };
  }

  async validate(config: Json, credentials: Credentials): Promise<Json> {
    const c = this.config(config);
    const repo = await this.api<{ default_branch: string; full_name: string }>(credentials, "GET", `/repos/${c.repository}`);
    return { repository: repo.full_name, base: c.base ?? repo.default_branch };
  }

  async browse(config: Json, credentials: Credentials, input: BrowseInput): Promise<{ items: ExternalItem[]; cursor: string | null }> {
    const c = this.config(config);
    const path = input.parent ?? "";
    const list = await this.api<{ type: string; path: string; name: string; size: number }[]>(credentials, "GET", `/repos/${c.repository}/contents/${encodeURI(path)}`);
    return {
      items: (Array.isArray(list) ? list : [])
        .filter((e) => e.type === "dir" || e.type === "file")
        .map((e) => ({ id: e.path, name: e.name, kind: e.type === "dir" ? ("folder" as const) : ("file" as const), label: e.type === "dir" ? "Pasta" : "Código", modified_at: null, size_bytes: e.size, importable: e.type === "file" && e.size <= 500_000 })),
      cursor: null,
    };
  }

  async fetch(config: Json, credentials: Credentials, itemId: string): Promise<FetchedItem> {
    const c = this.config(config);
    const file = await this.api<{ content?: string; encoding?: string; sha: string; name: string; path: string }>(credentials, "GET", `/repos/${c.repository}/contents/${encodeURI(itemId)}`);
    if (file.encoding !== "base64" || !file.content) throw conflict("github_not_a_file", "Isto não é um arquivo de texto do repositório");
    const text = Buffer.from(file.content, "base64").toString("utf8");
    return { title: `${c.repository}: ${file.path}`, filename: `${file.name}.txt`, mediaType: "text/plain", bytes: new TextEncoder().encode(`Arquivo ${file.path} do repositório ${c.repository}\n\n${text}`), revision: file.sha };
  }

  async revision(config: Json, credentials: Credentials, itemId: string): Promise<string> {
    const c = this.config(config);
    return (await this.api<{ sha: string }>(credentials, "GET", `/repos/${c.repository}/contents/${encodeURI(itemId)}`)).sha;
  }

  /** Abre um pull request (branch nova, um commit) com a entrega e os arquivos de código dela. */
  async write(config: Json, credentials: Credentials, file: { filename: string; text: string }) {
    const c = this.config(config);
    const base = c.base ?? (await this.api<{ default_branch: string }>(credentials, "GET", `/repos/${c.repository}`)).default_branch;
    const files = [{ path: `docs/aurora/${file.filename}`, content: file.text }, ...extractFiles(file.text)];
    const head = await this.api<{ object: { sha: string } }>(credentials, "GET", `/repos/${c.repository}/git/ref/heads/${encodeURIComponent(base)}`);
    const baseCommit = await this.api<{ tree: { sha: string } }>(credentials, "GET", `/repos/${c.repository}/git/commits/${head.object.sha}`);
    const tree = await this.api<{ sha: string }>(credentials, "POST", `/repos/${c.repository}/git/trees`, {
      base_tree: baseCommit.tree.sha,
      tree: files.map((f) => ({ path: f.path, mode: "100644", type: "blob", content: f.content })),
    });
    const title = file.filename.replace(/\.[a-z]+$/, "");
    const commit = await this.api<{ sha: string }>(credentials, "POST", `/repos/${c.repository}/git/commits`, { message: `Aurora: ${title}`, tree: tree.sha, parents: [head.object.sha] });
    const branch = `aurora/${slug(title)}-${this.now().toISOString().slice(0, 19).replace(/[-:T]/g, "")}`;
    await this.api(credentials, "POST", `/repos/${c.repository}/git/refs`, { ref: `refs/heads/${branch}`, sha: commit.sha });
    const pr = await this.api<{ html_url: string; number: number }>(credentials, "POST", `/repos/${c.repository}/pulls`, {
      title: `Aurora: ${title}`,
      head: branch,
      base,
      body: `Entrega aceita no Aurora, com ${files.length - 1} arquivo(s) de código.\n\nO merge é seu; o CI do repositório roda os testes neste pull request.`,
    });
    return { location: pr.html_url };
  }
}

// ── Meta: WhatsApp Business e Página do Facebook ────────────────────────────────

const GRAPH = "https://graph.facebook.com/v21.0";
const notReadable = () => conflict("not_readable", "Este conector só envia entregas aceitas");

async function graph<T>(http: ExternalHttp, credentials: Credentials, path: string, body: unknown, service: string): Promise<T> {
  const r = await http.request(`${GRAPH}${path}`, { service, method: "POST", headers: { authorization: `Bearer ${await token(credentials)}`, "content-type": "application/json" }, body: JSON.stringify(body) });
  const data = json(r.bytes) as { error?: { message?: string; code?: number } } & T;
  if (r.status === 401 || data?.error?.code === 190) throw unauthenticated("reauth_required", `A Meta recusou o token do ${service}; gere outro e reconecte`);
  if (r.status >= 400 || data?.error) throw unavailable("meta_error", `${service}: ${data?.error?.message ?? `erro ${r.status}`}`);
  return data;
}

export class WhatsAppCloudAdapter implements ConnectorAdapter {
  readonly connectorId = "whatsapp";
  private readonly http: ExternalHttp;
  constructor(http: ExternalHttp) {
    this.http = http;
  }

  private config(raw: Json) {
    const c = (raw ?? {}) as { phone_number_id?: unknown; to?: unknown };
    if (typeof c.phone_number_id !== "string" || !/^\d{5,20}$/.test(c.phone_number_id)) throw invalid("invalid_phone_number_id", "Informe o Phone number ID do WhatsApp Business");
    const to = typeof c.to === "string" ? c.to.replace(/\D/g, "") : "";
    if (!/^\d{10,15}$/.test(to)) throw invalid("invalid_recipient", "Informe o número que recebe as entregas, com DDI (ex.: 5511999990000)");
    return { phone_number_id: c.phone_number_id, to };
  }

  async validate(config: Json) {
    return this.config(config) as unknown as Json;
  }
  async browse(): Promise<never> {
    throw notReadable();
  }
  async fetch(): Promise<never> {
    throw notReadable();
  }
  async revision(): Promise<never> {
    throw notReadable();
  }

  async write(config: Json, credentials: Credentials, file: { filename: string; text: string }) {
    const c = this.config(config);
    const body = file.text.length > 4000 ? `${file.text.slice(0, 3990)}…` : file.text;
    const sent = await graph<{ messages?: { id: string }[] }>(this.http, credentials, `/${c.phone_number_id}/messages`, { messaging_product: "whatsapp", to: c.to, type: "text", text: { body, preview_url: false } }, "WhatsApp");
    return { location: `whatsapp:${c.to}/${sent.messages?.[0]?.id ?? ""}` };
  }
}

export class FacebookPageAdapter implements ConnectorAdapter {
  readonly connectorId = "facebook_page";
  private readonly http: ExternalHttp;
  constructor(http: ExternalHttp) {
    this.http = http;
  }

  private config(raw: Json) {
    const c = (raw ?? {}) as { page_id?: unknown };
    if (typeof c.page_id !== "string" || !/^\d{5,25}$/.test(c.page_id)) throw invalid("invalid_page_id", "Informe o ID da página do Facebook");
    return { page_id: c.page_id };
  }

  async validate(config: Json) {
    return this.config(config) as unknown as Json;
  }
  async browse(): Promise<never> {
    throw notReadable();
  }
  async fetch(): Promise<never> {
    throw notReadable();
  }
  async revision(): Promise<never> {
    throw notReadable();
  }

  async write(config: Json, credentials: Credentials, file: { filename: string; text: string }) {
    const c = this.config(config);
    const posted = await graph<{ id?: string }>(this.http, credentials, `/${c.page_id}/feed`, { message: file.text.slice(0, 60_000) }, "Facebook");
    return { location: `facebook:${posted.id ?? c.page_id}` };
  }
}
