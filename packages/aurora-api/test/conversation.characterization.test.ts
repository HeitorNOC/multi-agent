// Conversa com o Chief of Staff pela API HTTP do servidor real (E2).
// Roda sobre SQLite ou, com AURORA_TEST_LEDGER=postgres, sobre PostgreSQL.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { pathToFileURL, fileURLToPath } from "node:url";
import { dropTestSchemas, fakeBackend, newStateDir, startApi, waitFor, type Api } from "./harness.ts";

let backend: Awaited<ReturnType<typeof fakeBackend>>;
const running: Api[] = [];
before(async () => {
  backend = await fakeBackend();
});
after(async () => {
  await Promise.all(running.map((a) => a.stop("SIGKILL")));
  await backend.close();
  await dropTestSchemas();
});

async function start(opts: { workerMode?: string; queueCapacity?: number; state?: string; extraConfig?: Record<string, unknown> } = {}) {
  const state = opts.state ?? newStateDir();
  const api = await startApi({ state, backend: backend.url, workerMode: opts.workerMode ?? "journey", queueCapacity: opts.queueCapacity, extraConfig: opts.extraConfig });
  running.push(api);
  return { api, state };
}
const newConversation = async (api: Api) => (await api.post("/api/conversations", { title: "Comercial" })).body.id as string;
const say = (api: Api, id: string, text: string, clientId?: string) =>
  api.post(`/api/conversations/${id}/messages`, clientId ? { text, client_message_id: clientId } : { text });
const jobs = async (api: Api) => (await api.get("/api/state")).body.jobs as any[];

test("um pedido abre um trabalho; a conversa mostra o trabalho, o estado e quem recebeu", async () => {
  const { api } = await start();
  const id = await newConversation(api);
  const sent = await say(api, id, "Analise as vendas e o estoque");
  assert.equal(sent.status, 201);
  assert.equal(sent.body.reply.role, "chief");
  assert.match(sent.body.reply.text, /Abri um trabalho/);
  const jobId = sent.body.reply.job.id;
  assert.ok(["queued", "running"].includes(sent.body.reply.job.status));
  assert.deepEqual((await jobs(api)).map((j) => j.id), [jobId], "o trabalho existe na jornada");

  // Depois do planejamento, a conversa mostra o estado atual e as capacidades acionadas.
  const view = await waitFor(async () => {
    const c = (await api.get(`/api/conversations/${id}`)).body;
    return c.messages[1].job.status === "awaiting_approval" && c;
  }, "parecer pronto");
  assert.deepEqual(view.messages[1].job.capabilities, ["sales_analysis", "inventory_analysis"]);

  const status = await say(api, id, "qual o status?");
  assert.match(status.body.reply.text, /aguardando sua aprovação/);
  assert.equal((await jobs(api)).length, 1, "perguntar o status não abre outro trabalho");
});

test("o fluxo continua pela jornada: aprovado o parecer, a conversa mostra o trabalho concluído", async () => {
  const { api } = await start();
  const id = await newConversation(api);
  const jobId = (await say(api, id, "proponha uma ação comercial")).body.reply.job.id;
  const ready = await waitFor(async () => {
    const j = (await jobs(api)).find((x) => x.id === jobId);
    return j?.status === "awaiting_approval" && j;
  }, "parecer pronto");
  assert.equal((await api.post(`/api/jobs/${jobId}/approve`, { hash: ready.review.hash })).status, 202);
  await waitFor(async () => (await api.get(`/api/conversations/${id}`)).body.messages[1].job.status === "completed", "concluído");
});

test("repetir o envio com o mesmo client_message_id não duplica a mensagem nem o trabalho", async () => {
  const { api } = await start();
  const id = await newConversation(api);
  const first = await say(api, id, "analise o estoque", "envio-http-0001");
  const again = await say(api, id, "analise o estoque", "envio-http-0001");
  assert.deepEqual([first.status, again.status], [201, 200]);
  assert.equal(again.body.reply.seq, first.body.reply.seq);
  assert.equal((await jobs(api)).length, 1);
  assert.equal((await api.get(`/api/conversations/${id}`)).body.messages.length, 2);
});

test("com a fila cheia o Chief of Staff explica a recusa e não cria trabalho", async () => {
  const { api } = await start({ workerMode: "hang", queueCapacity: 1 });
  const id = await newConversation(api);
  await say(api, id, "analise as vendas");
  await waitFor(async () => (await jobs(api))[0]?.status === "running", "primeiro em execução");
  await say(api, id, "analise o estoque"); // ocupa a única vaga da fila
  const refused = await say(api, id, "faça um relatório de vendas");
  assert.equal(refused.status, 201);
  assert.match(refused.body.reply.text, /Não consegui abrir o trabalho agora: fila cheia/);
  assert.equal(refused.body.reply.job, null);
  assert.equal((await jobs(api)).length, 2);
});

test("conversas e mensagens sobrevivem ao reinício da API", async () => {
  const { api, state } = await start();
  const id = await newConversation(api);
  await say(api, id, "olá");
  await api.stop("SIGKILL");
  const { api: restarted } = await start({ state });
  const list = (await restarted.get("/api/conversations")).body.conversations;
  assert.deepEqual(list.map((c: any) => [c.id, c.title, c.message_count]), [[id, "Comercial", 2]]);
});

test("rotas e validações: conversa inexistente, texto vazio e rota desconhecida", async () => {
  const { api } = await start();
  assert.equal((await api.get("/api/conversations/nao-existe")).status, 404);
  assert.equal((await say(api, "nao-existe", "oi")).status, 404);
  const id = await newConversation(api);
  assert.equal((await say(api, id, "   ")).status, 400);
  assert.equal((await api.post("/api/conversations", { title: "" })).status, 400);
  assert.equal((await api.get(`/api/conversations/${id}/outra`)).status, 404);
});

test("com a política do Aurora, o Chief of Staff escolhe entre os cenários do catálogo", async () => {
  const policyModule = pathToFileURL(fileURLToPath(new URL("../../../apps/aurora/domain/policy.ts", import.meta.url))).href;
  const { api } = await start({ workerMode: "hang", extraConfig: { policyModule } });
  const id = await newConversation(api);

  const campaign = await say(api, id, "Avalie a campanha Horizonte para novembro");
  assert.match(campaign.body.reply.text, /Abri um trabalho de "Campanha Horizonte"/);
  const incident = await say(api, id, "Priorize o incidente no CRM");
  assert.match(incident.body.reply.text, /Abri um trabalho de "Incidente no CRM"/);

  const { CATALOG } = await import(policyModule);
  const goals = Object.fromEntries(CATALOG.scenarios.map((s: any) => [s.id, s.goal]));
  const byId = Object.fromEntries((await jobs(api)).map((j) => [j.id, j.goal]));
  assert.equal(byId[campaign.body.reply.job.id], goals.campaign);
  assert.equal(byId[incident.body.reply.job.id], goals.incident);

  // A revisão de entrega de repositório tem fluxo próprio e não é oferecida pela conversa.
  const vague = await say(api, id, "o que você consegue fazer?");
  assert.doesNotMatch(vague.body.reply.text, /Revisar entrega do que/);
  assert.doesNotMatch(vague.body.reply.text, /Executar nova tarefa no que/, "sem repositório configurado, não é oferecida");
  assert.equal((await jobs(api)).length, 2);
});
