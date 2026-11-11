// N6 — conectores de ação com HTTP simulado: GitHub (lê o repositório e abre pull request com os
// arquivos da entrega), WhatsApp Business (mensagem) e Página do Facebook (post).
import assert from "node:assert/strict";
import { test } from "node:test";
import { AppError } from "../../shared/errors.ts";
import { extractFiles, FacebookPageAdapter, GitHubAdapter, WhatsAppCloudAdapter } from "./infrastructure/actions.ts";
import { ExternalHttp } from "./infrastructure/http-client.ts";

type Call = { method: string; url: string; body: unknown; auth: string | null };

function fakeHttp(routes: Record<string, (body: unknown) => unknown>) {
  const calls: Call[] = [];
  const http = new ExternalHttp({
    retries: 0,
    backoffMs: 0,
    fetch: (async (url: string, init: RequestInit) => {
      const method = init.method ?? "GET";
      const body = init.body ? JSON.parse(init.body as string) : undefined;
      calls.push({ method, url, body, auth: new Headers(init.headers).get("authorization") });
      const key = Object.keys(routes).find((k) => `${method} ${url}`.startsWith(k));
      if (!key) return new Response(JSON.stringify({ message: "not found" }), { status: 404 });
      return new Response(JSON.stringify(routes[key]!(body)), { status: 200 });
    }) as typeof fetch,
  });
  return { http, calls };
}
const creds = (token = "tok") => ({ get: async () => ({ token }), set: async () => undefined });
const code = (p: Promise<unknown>) => p.then(() => "ok", (e) => (e instanceof AppError ? e.code : String(e)));

const DELIVERABLE = `# Serviço de WebChat

Segue o serviço.

\`\`\`ts caminho=src/webchat/server.ts
export const port = 8080;
\`\`\`

\`\`\`yaml path=deploy/webchat.yaml
replicas: 2
\`\`\`

\`\`\`sh caminho=../../etc/passwd
nada
\`\`\`
`;

test("arquivos de código da entrega: caminho relativo e seguro", () => {
  assert.deepEqual(extractFiles(DELIVERABLE), [
    { path: "src/webchat/server.ts", content: "export const port = 8080;\n" },
    { path: "deploy/webchat.yaml", content: "replicas: 2\n" },
  ]);
  assert.deepEqual(extractFiles("```ts caminho=.git/config\nx\n```"), []);
});

test("GitHub: valida o repositório, lê arquivos para o Cérebro e abre pull request (nunca merge)", async () => {
  const R = "https://api.github.com/repos/acme/webchat";
  const { http, calls } = fakeHttp({
    [`GET ${R}/git/ref/heads/main`]: () => ({ object: { sha: "base-sha" } }),
    [`GET ${R}/git/commits/base-sha`]: () => ({ tree: { sha: "tree-base" } }),
    [`GET ${R}/contents/src/auth.ts`]: () => ({ type: "file", encoding: "base64", content: Buffer.from("export const auth = true;").toString("base64"), sha: "f1", name: "auth.ts", path: "src/auth.ts" }),
    [`GET ${R}/contents/`]: () => [{ type: "dir", path: "src", name: "src", size: 0 }, { type: "file", path: "README.md", name: "README.md", size: 10 }],
    [`GET ${R}`]: () => ({ default_branch: "main", full_name: "acme/webchat" }),
    [`POST ${R}/git/trees`]: () => ({ sha: "tree-new" }),
    [`POST ${R}/git/commits`]: () => ({ sha: "commit-new" }),
    [`POST ${R}/git/refs`]: () => ({}),
    [`POST ${R}/pulls`]: () => ({ html_url: "https://github.com/acme/webchat/pull/7", number: 7 }),
  });
  const gh = new GitHubAdapter(http, () => new Date("2026-03-01T10:00:00Z"));
  const config = await gh.validate({ repository: "acme/webchat" }, creds());
  assert.deepEqual(config, { repository: "acme/webchat", base: "main" });
  assert.deepEqual((await gh.browse(config, creds(), {})).items.map((i) => [i.id, i.kind]), [["src", "folder"], ["README.md", "file"]]);
  const file = await gh.fetch(config, creds(), "src/auth.ts");
  assert.match(new TextDecoder().decode(file.bytes), /^Arquivo src\/auth\.ts do repositório acme\/webchat\n\nexport const auth = true;/);
  assert.equal(file.revision, "f1");

  const { location } = await gh.write(config, creds(), { filename: "servico-webchat.md", text: DELIVERABLE });
  assert.equal(location, "https://github.com/acme/webchat/pull/7");
  const tree = calls.find((c) => c.url.endsWith("/git/trees"))!.body as { base_tree: string; tree: { path: string }[] };
  assert.deepEqual(tree.tree.map((t) => t.path), ["docs/aurora/servico-webchat.md", "src/webchat/server.ts", "deploy/webchat.yaml"]);
  assert.equal(tree.base_tree, "tree-base");
  const ref = calls.find((c) => c.url.endsWith("/git/refs"))!.body as { ref: string };
  assert.equal(ref.ref, "refs/heads/aurora/servico-webchat-20260301100000");
  const pr = calls.find((c) => c.url.endsWith("/pulls"))!.body as { head: string; base: string };
  assert.deepEqual([pr.head, pr.base], ["aurora/servico-webchat-20260301100000", "main"]);
  assert.ok(!calls.some((c) => c.url.includes("/merge")), "nunca faz merge");
  assert.ok(calls.every((c) => c.auth === "Bearer tok"));
  assert.equal(await code(gh.validate({ repository: "sem-barra" }, creds())), "invalid_repository");
});

test("WhatsApp e Facebook: enviam a entrega aceita; configuração validada; não leem", async () => {
  const { http, calls } = fakeHttp({
    "POST https://graph.facebook.com/v21.0/123456/messages": () => ({ messages: [{ id: "wamid.1" }] }),
    "POST https://graph.facebook.com/v21.0/998877/feed": () => ({ id: "998877_1" }),
  });
  const wa = new WhatsAppCloudAdapter(http);
  const cfg = await wa.validate({ phone_number_id: "123456", to: "+55 11 99999-0000" });
  assert.deepEqual(cfg, { phone_number_id: "123456", to: "5511999990000" });
  assert.deepEqual(await wa.write(cfg, creds(), { filename: "x.md", text: "Promoção de inverno: 20% em tintas." }), { location: "whatsapp:5511999990000/wamid.1" });
  assert.deepEqual((calls[0]!.body as { text: { body: string } }).text.body, "Promoção de inverno: 20% em tintas.");
  assert.equal(await code(wa.validate({ phone_number_id: "123456", to: "12" })), "invalid_recipient");
  assert.equal(await code(wa.browse()), "not_readable");

  const fb = new FacebookPageAdapter(http);
  assert.deepEqual(await fb.write(await fb.validate({ page_id: "998877" }), creds(), { filename: "post.md", text: "Novidade!" }), { location: "facebook:998877_1" });
  assert.equal(await code(fb.validate({ page_id: "abc" })), "invalid_page_id");
});
