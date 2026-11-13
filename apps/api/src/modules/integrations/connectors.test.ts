// Conectores com login (Google Drive, Gmail, Slack) contra serviços falsos: nenhuma conta real.
// Cobre o cofre, o login no Google (com renovação e revogação), navegar, importar, sincronizar só o
// que mudou, enviar entregas e o caminho HTTP completo do "Conectar com Google".
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, test } from "node:test";
import { manualClock } from "../../shared/clock.ts";
import { AppError } from "../../shared/errors.ts";
import { ActorId, type SourceId } from "../../shared/ids.ts";
import { UnitOfWork } from "../../platform/database/unit-of-work.ts";
import { dialects, fresh, type TestDatabase } from "../../../test/support/databases.ts";
import { docxWith } from "../../../test/support/office-files.ts";
import { loadConfig } from "../../config.ts";
import { startServer } from "../../server.ts";
import { ExtractiveAnswerer } from "../knowledge/application/answerers.ts";
import { KnowledgeSearch } from "../knowledge/application/knowledge-search.ts";
import { addVersion, listSources, uploadSource, viewSource, type KnowledgeDeps } from "../knowledge/application/sources.ts";
import { Bm25Index } from "../knowledge/infrastructure/bm25-index.ts";
import { extractDocumentText } from "../knowledge/infrastructure/document-text.ts";
import { knowledgeStore } from "../knowledge/infrastructure/sql-knowledge.ts";
import { changeConnection, connect, exportDeliverable, importFile, listFiles, syncConnection, viewConnection, type IntegrationsDeps } from "./application/integrations.ts";
import type { ConnectionId } from "./domain/connection.ts";
import { emailText, GmailAdapter, GoogleDriveAdapter, GoogleOAuth } from "./infrastructure/google.ts";
import { ExternalHttp } from "./infrastructure/http-client.ts";
import { LocalFolder } from "./infrastructure/local-folder.ts";
import { loadSecretKey, secretBox } from "./infrastructure/secret-box.ts";
import { SlackAdapter } from "./infrastructure/slack.ts";
import { integrationsStore } from "./infrastructure/sql-connections.ts";

const ana = ActorId.parse("ana");
const code = (p: Promise<unknown>) => p.then(() => "ok", (e) => (e instanceof AppError ? e.code : String(e)));
const KEY = Buffer.alloc(32, 7);
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

/** Google e Slack falsos: estado mutável para simular mudanças e revogação. */
function fakeServices() {
  const state = {
    docVersion: "1",
    docText: ["Política de compras", "Compras acima de dez mil exigem três cotações."],
    revoked: false,
    calls: [] as string[],
    uploads: [] as string[],
    posts: [] as { channel: string; text: string }[],
    tokens: 0,
  };
  const fetch = (async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = new URL(String(input));
    const path = url.origin + url.pathname;
    state.calls.push(`${init?.method ?? "GET"} ${path}`);
    if (path === "https://oauth2.googleapis.com/token") {
      const p = new URLSearchParams(String(init?.body));
      if (state.revoked) return json({ error: "invalid_grant" }, 400);
      state.tokens++;
      if (p.get("grant_type") === "authorization_code") return json({ access_token: `at-${state.tokens}`, refresh_token: "rt-1", expires_in: 3600 });
      return json({ access_token: `at-${state.tokens}`, expires_in: 3600 });
    }
    const auth = (init?.headers as Record<string, string> | undefined)?.authorization ?? "";
    if (url.hostname.endsWith("googleapis.com") && !auth.startsWith("Bearer at-")) return json({ error: "unauthorized" }, 401);
    const drive = "https://www.googleapis.com/drive/v3";
    if (path === `${drive}/about`) return json({ user: { emailAddress: "ana@empresa.com" } });
    if (path === `${drive}/files` && !url.searchParams.get("q")?.includes("contains"))
      return json({
        files: [
          { id: "pasta1", name: "Contratos", mimeType: "application/vnd.google-apps.folder", modifiedTime: "2026-03-01T00:00:00Z" },
          { id: "doc1", name: "Política de compras", mimeType: "application/vnd.google-apps.document", modifiedTime: "2026-03-01T00:00:00Z" },
          { id: "zip1", name: "backup.zip", mimeType: "application/zip", size: "10" },
        ],
      });
    if (path === `${drive}/files/doc1`) return json({ id: "doc1", name: "Política de compras", mimeType: "application/vnd.google-apps.document", version: state.docVersion });
    if (path === `${drive}/files/doc1/export`) return new Response(Buffer.from(docxWith(state.docText)));
    if (path === "https://www.googleapis.com/upload/drive/v3/files") {
      state.uploads.push(String(init?.body));
      return json({ id: "novo1", webViewLink: "https://drive.google.com/file/d/novo1" });
    }
    const gmail = "https://gmail.googleapis.com/gmail/v1/users/me";
    if (path === `${gmail}/profile`) return json({ emailAddress: "ana@empresa.com" });
    if (path === `${gmail}/messages`) return json({ messages: [{ id: "m1" }] });
    if (path === `${gmail}/messages/m1`) {
      const headers = [
        { name: "Subject", value: "Reajuste do fornecedor Alfa" },
        { name: "From", value: "Alfa <vendas@alfa.com>" },
        { name: "To", value: "ana@empresa.com" },
      ];
      return json({
        id: "m1",
        internalDate: "1772366400000",
        payload: { mimeType: "multipart/alternative", headers, parts: [{ mimeType: "text/plain", body: { data: Buffer.from("O reajuste será de 4% a partir de abril.").toString("base64url") } }] },
      });
    }
    if (url.hostname === "slack.com") {
      if (auth !== "Bearer xoxb-teste-1234567890") return json({ ok: false, error: "invalid_auth" });
      const method = url.pathname.replace("/api/", "");
      if (method === "auth.test") return json({ ok: true, team: "Empresa" });
      if (method === "conversations.list")
        return json({ ok: true, channels: [{ id: "C0001AAAA", name: "compras", is_member: true, num_members: 4 }, { id: "C0002BBBB", name: "geral", is_member: false }] });
      if (method === "conversations.info") return json({ ok: true, channel: { id: "C0001AAAA", name: "compras" } });
      if (method === "conversations.history" && url.searchParams.get("channel") === "C0002BBBB") return json({ ok: false, error: "not_in_channel" });
      if (method === "conversations.history") return json({ ok: true, messages: [{ ts: "1772366400.000100", user: "U1", text: "Fechamos com a <@U1> o frete a 8%" }] });
      if (method === "users.info") return json({ ok: true, user: { real_name: "Bruno Lima" } });
      if (method === "chat.postMessage") {
        const b = JSON.parse(String(init?.body));
        state.posts.push({ channel: b.channel, text: b.text });
        return json({ ok: true, ts: "1.2" });
      }
    }
    return json({ error: "rota desconhecida no teste" }, 404);
  }) as typeof globalThis.fetch;
  return { state, fetch };
}

test("cofre: cifra, abre só com a mesma chave e cria o arquivo da chave na primeira vez", () => {
  const box = secretBox(KEY);
  const sealed = box.seal(JSON.stringify({ token: "xoxb-segredo" }));
  assert.ok(!sealed.includes("segredo"));
  assert.equal(JSON.parse(box.open(sealed)).token, "xoxb-segredo");
  assert.throws(() => secretBox(Buffer.alloc(32, 8)).open(sealed), /outra chave/);
  assert.throws(() => box.open(sealed.slice(0, -4) + "AAAA"));
  const dir = mkdtempSync(join(tmpdir(), "aurora-key-"));
  try {
    const file = join(dir, "aurora.key");
    const key = loadSecretKey({ file });
    assert.ok(existsSync(file));
    assert.deepEqual(loadSecretKey({ file }), key, "a mesma chave nas próximas vezes");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("Gmail: texto do e-mail prefere texto puro; HTML vira texto sem marcas", () => {
  const b = (s: string) => ({ data: Buffer.from(s).toString("base64url") });
  assert.equal(emailText({ mimeType: "multipart/alternative", parts: [{ mimeType: "text/html", body: b("<p>Oi</p>") }, { mimeType: "text/plain", body: b("Oi") }] }), "Oi");
  assert.equal(emailText({ mimeType: "text/html", body: b("<p>Olá&nbsp;<b>Ana</b></p><script>x()</script>") }).trim(), "Olá Ana");
});

const opened: TestDatabase[] = [];
afterEach(async () => {
  for (const d of opened.splice(0)) await d.close();
});

for (const dialect of dialects) {
  describe(`Conectores com login — ${dialect}`, () => {
    async function setup() {
      const d = await fresh(dialect);
      opened.push(d);
      const clock = manualClock("2026-03-01T10:00:00.000Z");
      const { state, fetch } = fakeServices();
      const http = new ExternalHttp({ fetch, backoffMs: 0 });
      const oauth = new GoogleOAuth({ clientId: "cliente", clientSecret: "segredo" }, http, () => Date.parse(clock.now()));
      const kuow = new UnitOfWork(d.db, knowledgeStore(clock));
      const knowledge: KnowledgeDeps = { uow: kuow, clock, search: new KnowledgeSearch(kuow, clock, (p) => new Bm25Index(p)), answerer: new ExtractiveAnswerer(), maxBytes: 1_000_000, extract: extractDocumentText };
      const deps: IntegrationsDeps = {
        uow: new UnitOfWork(d.db, integrationsStore(clock)),
        clock,
        folder: new LocalFolder({ forbidden: [], maxBytes: 1_000_000 }),
        importToKnowledge: async (actor, file) => {
          const s = await uploadSource(knowledge, actor, file);
          return { id: s.id, title: s.title };
        },
        versionToKnowledge: async (actor, id, file) => {
          try {
            await addVersion(knowledge, actor, id as SourceId, file);
            return { changed: true };
          } catch (e) {
            if (e instanceof AppError && e.code === "same_content") return { changed: false };
            throw e;
          }
        },
        acceptedDeliverable: async () => ({ filename: "parecer-compras.md", text: "# Parecer\n\nFicar com o fornecedor Alfa." }),
        vault: secretBox(KEY),
        adapters: { google_drive: new GoogleDriveAdapter(http, oauth), gmail: new GmailAdapter(http, oauth), slack: new SlackAdapter(http) },
      };
      return { d, deps, knowledge, state, oauth, clock };
    }

    test("Drive: navegar, importar Doc, reimportar sem mudança, sincronizar quando muda, salvar entrega", async () => {
      const { d, deps, knowledge, state, oauth } = await setup();
      const tokens = await oauth.exchange("codigo", "verificador", "http://localhost/cb");
      const c = await connect(deps, ana, { connectorId: "google_drive", name: "Drive da Ana", config: {}, permissions: { read: true, write: true }, secret: tokens });
      const id = c.id as ConnectionId;
      assert.equal(JSON.stringify(c).includes("rt-1"), false, "o token nunca aparece na conexão");
      const raw = await d.db.sql.one<{ sealed: string }>("SELECT sealed FROM connection_secrets WHERE connection_id = $1", [id]);
      assert.equal(raw!.sealed.includes("rt-1"), false, "no banco, só cifrado");
      const browse = await listFiles(deps, ana, id);
      assert.deepEqual(browse.items!.map((i) => [i.name, i.kind, i.label, i.importable]), [
        ["Contratos", "folder", "Pasta", false],
        ["Política de compras", "file", "Doc", true],
        ["backup.zip", "file", "Outro", false],
      ]);
      const first = await importFile(deps, ana, id, { item: "doc1" });
      assert.equal(first.changed, true);
      assert.equal((await viewSource(knowledge, ana, first.source.id as SourceId)).format?.label, "Word");
      assert.equal((await listFiles(deps, ana, id)).items![1]!.source, first.source.id, "a tela sabe que já foi importado");
      assert.equal((await importFile(deps, ana, id, { item: "doc1" })).changed, false, "mesmo conteúdo: sem versão nova");
      assert.deepEqual(await syncConnection(deps, ana, id), { updated: [], unchanged: ["Política de compras"], failed: [] });
      const exports = state.calls.filter((c) => c.endsWith("/export")).length;
      await syncConnection(deps, ana, id);
      assert.equal(state.calls.filter((c) => c.endsWith("/export")).length, exports, "revisão igual: não baixa de novo");
      state.docVersion = "2";
      state.docText = ["Política de compras", "Compras acima de vinte mil exigem três cotações."];
      assert.deepEqual((await syncConnection(deps, ana, id)).updated, ["Política de compras"]);
      const source = await viewSource(knowledge, ana, first.source.id as SourceId);
      assert.equal(source.versions.length, 2, "mudou no Drive: versão nova da mesma fonte");
      assert.equal((await listSources(knowledge, ana)).sources.length, 1);
      const saved = await exportDeliverable(deps, ana, id, { deliverableId: "d1", version: 1 });
      assert.equal(saved.file, "https://drive.google.com/file/d/novo1");
      assert.match(state.uploads[0]!, /Ficar com o fornecedor Alfa/);
    });

    test("Google: token renovado sozinho; acesso revogado marca a conexão e reconectar resolve", async () => {
      const { deps, state, oauth, clock } = await setup();
      const c = await connect(deps, ana, { connectorId: "gmail", name: "E-mail", config: {}, permissions: { read: true }, secret: await oauth.exchange("c", "v", "r") });
      const id = c.id as ConnectionId;
      const before = state.tokens;
      clock.advance(2 * 3600_000);
      const mail = await listFiles(deps, ana, id);
      assert.equal(state.tokens, before + 1, "o token de acesso venceu e foi renovado");
      assert.deepEqual(mail.items!.map((m) => [m.name, m.detail]), [["Reajuste do fornecedor Alfa", "Alfa <vendas@alfa.com>"]]);
      const imported = await importFile(deps, ana, id, { item: "m1" });
      assert.equal(imported.source.title, "Reajuste do fornecedor Alfa");
      assert.equal(await code(exportDeliverable(deps, ana, id, { deliverableId: "d1", version: 1 })), "permission_denied", "Gmail é só leitura");
      state.revoked = true;
      clock.advance(2 * 3600_000);
      assert.equal(await code(listFiles(deps, ana, id)), "reauth_required");
      assert.equal((await viewConnection(deps, id)).problem, "reauth_required");
      state.revoked = false;
      await changeConnection(deps, ana, id, { secret: await oauth.exchange("c2", "v", "r"), active: true });
      assert.equal((await viewConnection(deps, id)).problem, null);
      assert.equal((await listFiles(deps, ana, id)).items!.length, 1);
    });

    test("Slack: token conferido, canais, importar conversa com nomes, canal sem o bot, publicar entrega", async () => {
      const { deps, state, d } = await setup();
      assert.equal(await code(connect(deps, ana, { connectorId: "slack", name: "Slack", config: {}, permissions: { read: true }, secret: { token: "abc" } })), "invalid_slack_token");
      assert.equal(await code(connect(deps, ana, { connectorId: "slack", name: "Slack", config: {}, permissions: { read: true }, secret: { token: "xoxb-errado-0000000000" } })), "reauth_required");
      const c = await connect(deps, ana, { connectorId: "slack", name: "Slack", config: { channel_id: "C0001AAAA" }, permissions: { read: true, write: true }, secret: { token: "xoxb-teste-1234567890" } });
      const id = c.id as ConnectionId;
      assert.deepEqual(c.config, { team: "Empresa", channel_id: "C0001AAAA" });
      const channels = await listFiles(deps, ana, id);
      assert.deepEqual(channels.items!.map((ch) => [ch.name, ch.importable]), [["#compras", true], ["#geral", false]]);
      const { source } = await importFile(deps, ana, id, { item: "C0001AAAA" });
      assert.equal(source.title, "Slack #compras");
      assert.equal(await code(importFile(deps, ana, id, { item: "C0002BBBB" })), "slack_not_in_channel");
      await exportDeliverable(deps, ana, id, { deliverableId: "d1", version: 1 });
      assert.deepEqual(state.posts.map((p) => p.channel), ["C0001AAAA"]);
      await changeConnection(deps, ana, id, { active: false });
      assert.equal(await d.db.sql.one("SELECT sealed FROM connection_secrets WHERE connection_id = $1", [id]), undefined, "desconectar apaga o token");
    });
  });
}

test("HTTP: Conectar com Google cria a conexão; sem o cookie do navegador, não", async () => {
  const dir = mkdtempSync(join(tmpdir(), "aurora-connect-"));
  const { fetch } = fakeServices();
  const config = loadConfig({
    AURORA_SQLITE_PATH: join(dir, "aurora.db"),
    AURORA_EMBEDDINGS: "none",
    AURORA_WEB_DIR: "none",
    AURORA_GOOGLE_CLIENT_ID: "cliente",
    AURORA_GOOGLE_CLIENT_SECRET: "segredo",
  });
  const server = await startServer(config, { templates: { areas: [], templates: [] }, model: null, oauthFetch: fetch });
  try {
    const catalog = await (await globalThis.fetch(server.url + "/api/integrations/catalog")).json();
    const ready = catalog.categories.flatMap((c: { connectors: { id: string; ready: boolean }[] }) => c.connectors).filter((c: { ready: boolean }) => c.ready).map((c: { id: string }) => c.id);
    assert.deepEqual(ready.sort(), ["facebook_page", "github", "gmail", "google_drive", "local_folder", "postgres_readonly", "slack", "whatsapp"]);
    const start = await globalThis.fetch(server.url + "/api/integrations/google/start?connector=google_drive&name=Drive&read=1&write=1", { redirect: "manual" });
    assert.equal(start.status, 302);
    const consent = new URL(start.headers.get("location")!);
    assert.equal(consent.searchParams.get("access_type"), "offline");
    assert.match(consent.searchParams.get("scope")!, /drive\.readonly/);
    const state = consent.searchParams.get("state")!;
    const callback = `${server.url}/api/integrations/google/callback?state=${state}&code=abc`;
    const forged = await globalThis.fetch(callback, { redirect: "manual" });
    assert.equal(forged.headers.get("location"), "/integracoes?erro=google_expired");
    const again = await globalThis.fetch(server.url + "/api/integrations/google/start?connector=google_drive&name=Drive", { redirect: "manual" });
    const s2 = new URL(again.headers.get("location")!).searchParams.get("state")!;
    const back = await globalThis.fetch(`${server.url}/api/integrations/google/callback?state=${s2}&code=abc`, {
      redirect: "manual",
      headers: { cookie: again.headers.get("set-cookie")!.split(";")[0]! },
    });
    assert.match(back.headers.get("location")!, /^\/integracoes\?conectado=/);
    const list = await (await globalThis.fetch(server.url + "/api/integrations")).json();
    assert.deepEqual(list.connections.map((c: { connector_id: string; permissions: object }) => [c.connector_id, c.permissions]), [["google_drive", { read: true, write: false }]]);
  } finally {
    await server.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
