/**
 * Slack com um token de bot (xoxb-…) de um app criado pela empresa e instalado no workspace.
 * (O Slack não aceita endereço de retorno `http://localhost`, então não há login por OAuth aqui.)
 *
 * - Ler: lista os canais em que o bot está e traz as mensagens recentes de um canal para o Cérebro
 *   (com nomes das pessoas e data), como um documento.
 * - Escrever: publica a entrega aceita no canal configurado.
 * O token fica cifrado no cofre e nunca sai pela API.
 */
import { conflict, invalid, unauthenticated, unavailable } from "../../../shared/errors.ts";
import type { Json } from "../../../shared/json.ts";
import type { BrowseInput, ConnectorAdapter, Credentials, ExternalItem, FetchedItem } from "../domain/adapter.ts";
import type { ExternalHttp } from "./http-client.ts";

const API = "https://slack.com/api";
/** Mensagens trazidas por canal (as mais recentes). */
const HISTORY = 300;
/** O Slack aceita até 40 mil caracteres; acima disso, a entrega vai resumida com aviso. */
const MAX_POST = 39_000;

interface SlackChannel {
  id: string;
  name: string;
  is_private?: boolean;
  is_member?: boolean;
  num_members?: number;
  updated?: number;
}
interface SlackMessage {
  ts: string;
  user?: string;
  bot_id?: string;
  text?: string;
  subtype?: string;
  reply_count?: number;
}

export class SlackAdapter implements ConnectorAdapter {
  readonly connectorId = "slack";
  private readonly http: ExternalHttp;
  private readonly users = new Map<string, string>();

  constructor(http: ExternalHttp) {
    this.http = http;
  }

  private async call<T>(credentials: Credentials, method: string, params: Record<string, string>, post = false): Promise<T> {
    const { token } = await credentials.get();
    const url = post ? `${API}/${method}` : `${API}/${method}?${new URLSearchParams(params)}`;
    const { body } = await this.http.json<T & { ok: boolean; error?: string }>(url, {
      service: "Slack",
      method: post ? "POST" : "GET",
      headers: { authorization: `Bearer ${token}`, ...(post ? { "content-type": "application/json; charset=utf-8" } : {}) },
      ...(post ? { body: JSON.stringify(params) } : {}),
    });
    if (!body.ok) {
      const error = body.error ?? "unknown";
      if (["invalid_auth", "not_authed", "token_revoked", "account_inactive", "token_expired"].includes(error))
        throw unauthenticated("reauth_required", "O token do Slack não vale mais. Cole um token novo na conexão.");
      if (error === "not_in_channel") throw conflict("slack_not_in_channel", "O bot não está neste canal. No Slack, convide o app para o canal (/invite @nome-do-app).");
      if (error === "missing_scope") throw conflict("slack_missing_scope", "Falta permissão no app do Slack (veja os escopos pedidos na tela de Integrações)");
      if (error === "channel_not_found") throw invalid("external_not_found", "Canal não encontrado no Slack");
      throw unavailable("slack_failed", `O Slack recusou o pedido (${error})`);
    }
    return body;
  }

  async validate(config: Json, credentials: Credentials) {
    const { token } = await credentials.get();
    if (!/^xoxb-[\w-]{10,}$/.test(token ?? "")) throw invalid("invalid_slack_token", "Cole o Bot User OAuth Token do app (começa com xoxb-)");
    const auth = await this.call<{ team?: string }>(credentials, "auth.test", {});
    const channel = (config as { channel_id?: unknown } | null)?.channel_id;
    if (channel !== undefined && channel !== null && (typeof channel !== "string" || !/^[CG][A-Z0-9]{6,}$/.test(channel)))
      throw invalid("invalid_channel", "Canal do Slack inválido (use o id, como C0123ABCD)");
    return { team: auth.team ?? null, ...(typeof channel === "string" ? { channel_id: channel } : {}) } as Json;
  }

  async browse(_config: Json, credentials: Credentials, input: BrowseInput) {
    const body = await this.call<{ channels?: SlackChannel[]; response_metadata?: { next_cursor?: string } }>(credentials, "conversations.list", {
      types: "public_channel,private_channel",
      exclude_archived: "true",
      limit: "200",
      ...(input.cursor ? { cursor: input.cursor } : {}),
    });
    const q = input.query?.trim().toLowerCase();
    const items: ExternalItem[] = (body.channels ?? [])
      .filter((c) => !q || c.name.toLowerCase().includes(q))
      .map((c) => ({
        id: c.id,
        name: `#${c.name}`,
        kind: "channel",
        label: c.is_private ? "Canal privado" : "Canal",
        modified_at: c.updated ? new Date(c.updated).toISOString() : null,
        detail: c.is_member ? `${c.num_members ?? "?"} membros` : "O bot não está no canal (convide para importar)",
        importable: !!c.is_member,
      }));
    return { items, cursor: body.response_metadata?.next_cursor || null };
  }

  private async history(credentials: Credentials, channel: string) {
    const body = await this.call<{ messages?: SlackMessage[] }>(credentials, "conversations.history", { channel, limit: String(HISTORY) });
    return (body.messages ?? []).filter((m) => !m.subtype || m.subtype === "thread_broadcast");
  }

  async revision(_config: Json, credentials: Credentials, channel: string) {
    const body = await this.call<{ messages?: SlackMessage[] }>(credentials, "conversations.history", { channel, limit: "1" });
    return body.messages?.[0]?.ts ?? "vazio";
  }

  async fetch(_config: Json, credentials: Credentials, channel: string): Promise<FetchedItem> {
    const info = await this.call<{ channel?: SlackChannel }>(credentials, "conversations.info", { channel });
    const name = info.channel?.name ?? channel;
    const messages = (await this.history(credentials, channel)).reverse();
    const lines: string[] = [`# Slack #${name}`, "", `Mensagens mais recentes (até ${HISTORY}), da mais antiga para a mais nova.`, ""];
    let day = "";
    for (const m of messages) {
      const when = new Date(Number(m.ts) * 1000);
      const d = when.toISOString().slice(0, 10);
      if (d !== day) lines.push("", `## ${d}`, "");
      day = d;
      const who = m.user ? await this.userName(credentials, m.user) : "bot";
      lines.push(`- **${who}** (${when.toISOString().slice(11, 16)}): ${this.plain(m.text ?? "")}${m.reply_count ? ` _(${m.reply_count} respostas)_` : ""}`);
    }
    if (!messages.length) lines.push("_Sem mensagens._");
    return {
      title: `Slack #${name}`,
      filename: `slack-${name}.md`,
      mediaType: "text/markdown",
      bytes: new TextEncoder().encode(lines.join("\n")),
      revision: messages.at(-1)?.ts ?? "vazio",
    };
  }

  async write(config: Json, credentials: Credentials, file: { filename: string; text: string }) {
    const channel = (config as { channel_id?: string }).channel_id;
    if (!channel) throw invalid("slack_channel_required", "Escolha o canal onde as entregas serão publicadas (id do canal na conexão)");
    const text = file.text.length > MAX_POST ? `${file.text.slice(0, MAX_POST)}\n\n_(entrega cortada pelo limite do Slack; a versão completa está no Aurora)_` : file.text;
    const posted = await this.call<{ ts?: string }>(credentials, "chat.postMessage", { channel, text, mrkdwn: "true" }, true);
    return { location: `slack:${channel}/${posted.ts ?? ""}` };
  }

  private async userName(credentials: Credentials, id: string) {
    const cached = this.users.get(id);
    if (cached) return cached;
    try {
      const body = await this.call<{ user?: { real_name?: string; name?: string } }>(credentials, "users.info", { user: id });
      const name = body.user?.real_name || body.user?.name || id;
      this.users.set(id, name);
      return name;
    } catch {
      return id; // sem `users:read`, mostra o id
    }
  }

  /** Menções e links do Slack em texto legível. */
  private plain(text: string) {
    return text
      .replace(/<@([A-Z0-9]+)>/g, (_m, id: string) => `@${this.users.get(id) ?? id}`)
      .replace(/<#[A-Z0-9]+\|([^>]+)>/g, "#$1")
      .replace(/<(https?:[^|>]+)\|([^>]+)>/g, "$2 ($1)")
      .replace(/<(https?:[^>]+)>/g, "$1")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&amp;/g, "&")
      .replace(/\n/g, " ");
  }
}
