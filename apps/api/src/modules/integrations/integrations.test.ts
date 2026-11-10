// Integrações com o conector de pasta local, nos dois bancos: conectar, ler para o Cérebro,
// gravar entregas aceitas e recusar (e registrar) tudo o que não foi autorizado.
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, test } from "node:test";
import { manualClock } from "../../shared/clock.ts";
import { AppError, conflict } from "../../shared/errors.ts";
import { ActorId } from "../../shared/ids.ts";
import { UnitOfWork } from "../../platform/database/unit-of-work.ts";
import { createHttpApp } from "../../platform/http/app.ts";
import { dialects, fresh, type TestDatabase } from "../../../test/support/databases.ts";
import { ExtractiveAnswerer } from "../knowledge/application/answerers.ts";
import { KnowledgeSearch } from "../knowledge/application/knowledge-search.ts";
import { listSources, uploadSource } from "../knowledge/application/sources.ts";
import { Bm25Index } from "../knowledge/infrastructure/bm25-index.ts";
import { knowledgeStore } from "../knowledge/infrastructure/sql-knowledge.ts";
import { catalogView, changeConnection, connect, exportDeliverable, importFile, listFiles, viewConnection, type IntegrationsDeps } from "./application/integrations.ts";
import type { ConnectionId } from "./domain/connection.ts";
import { integrationsHttp } from "./http/routes.ts";
import { LocalFolder } from "./infrastructure/local-folder.ts";
import { integrationsStore } from "./infrastructure/sql-connections.ts";

const ana = ActorId.parse("ana");
const code = (p: Promise<unknown>) => p.then(() => "ok", (e) => (e instanceof AppError ? e.code : String(e)));
const cleanups: (() => Promise<void> | void)[] = [];
afterEach(async () => {
  for (const c of cleanups.splice(0)) await c();
});

function workspace() {
  const root = mkdtempSync(join(tmpdir(), "aurora-int-"));
  cleanups.push(() => rmSync(root, { recursive: true, force: true }));
  const folder = join(root, "documentos");
  const data = join(root, "dados-aurora");
  mkdirSync(folder);
  mkdirSync(data);
  writeFileSync(join(folder, "politica-compras.md"), "# Compras\n\nCompras acima de dez mil reais exigem três cotações.");
  writeFileSync(join(folder, "planilha.xlsx"), "binário");
  writeFileSync(join(root, "fora.md"), "não deve ser lido");
  mkdirSync(join(folder, "subpasta"));
  return { root, folder, data };
}

describe("pasta local: proteções de caminho", () => {
  test("lista só arquivos aceitos do primeiro nível; não sai da pasta; não sobrescreve", async () => {
    const { root, folder, data } = workspace();
    const driver = new LocalFolder({ forbidden: [data], maxBytes: 10_000 });
    const config = await driver.validate({ path: folder });
    assert.deepEqual((await driver.list(config)).map((f) => f.name), ["politica-compras.md"]);
    for (const evil of ["../fora.md", "..\\fora.md", join(root, "fora.md"), "subpasta", ".."]) assert.equal(await code(driver.read(config, evil)), evil === "subpasta" ? "unsafe_file" : "invalid_file_name", evil);
    assert.equal(await code(driver.read(config, "nao-existe.md")), "file_not_found");
    assert.equal(await driver.write(config, "entrega.md", "v1"), "entrega.md");
    assert.equal(await driver.write(config, "entrega.md", "v1 de novo"), "entrega (2).md");
    assert.equal(readFileSync(join(folder, "entrega.md"), "utf8"), "v1", "o primeiro arquivo continua intacto");
    assert.equal(await code(driver.validate({ path: "relativa/pasta" })), "invalid_folder");
    assert.equal(await code(driver.validate({ path: join(root, "nao-existe") })), "folder_not_found");
    assert.equal(await code(driver.validate({ path: data })), "folder_forbidden");
    assert.equal(await code(driver.validate({ path: root })), "folder_forbidden", "pasta que contém os dados do Aurora também não");
  });

  test("atalho (symlink) para fora da pasta não é listado nem lido", async (t) => {
    const { root, folder } = workspace();
    try {
      symlinkSync(join(root, "fora.md"), join(folder, "atalho.md"));
    } catch {
      t.skip("este sistema não permite criar atalhos sem privilégio");
      return;
    }
    const driver = new LocalFolder({ forbidden: [], maxBytes: 10_000 });
    const config = await driver.validate({ path: folder });
    assert.ok(!(await driver.list(config)).some((f) => f.name === "atalho.md"));
    assert.equal(await code(driver.read(config, "atalho.md")), "unsafe_file");
  });
});

for (const dialect of dialects) {
  describe(`integrações — ${dialect}`, () => {
    async function setup() {
      const { folder, data } = workspace();
      const d: TestDatabase = await fresh(dialect);
      cleanups.push(() => d.close());
      const clock = manualClock("2026-03-01T10:00:00.000Z");
      const kuow = new UnitOfWork(d.db, knowledgeStore(clock));
      const knowledge = { uow: kuow, clock, search: new KnowledgeSearch(kuow, clock, (p) => new Bm25Index(p)), answerer: new ExtractiveAnswerer(), maxBytes: 10_000 };
      const accepted = new Set<string>(["d-aceita@1"]);
      const deps: IntegrationsDeps = {
        uow: new UnitOfWork(d.db, integrationsStore(clock)),
        clock,
        folder: new LocalFolder({ forbidden: [data], maxBytes: 10_000 }),
        importToKnowledge: async (actor, file) => {
          const s = await uploadSource(knowledge, actor, file);
          return { id: s.id, title: s.title };
        },
        acceptedDeliverable: async (id, version) => {
          if (!accepted.has(`${id}@${version}`)) throw conflict("deliverable_not_accepted", "Só a versão aceita de uma entrega pode sair da empresa");
          return { filename: `entrega-${id}-v${version}.md`, text: `# Entrega ${id}` };
        },
      };
      return { deps, folder, knowledge };
    }

    test("catálogo por categoria: só a pasta local disponível; os demais não conectam", async () => {
      const { deps, folder } = await setup();
      const cat = await catalogView(deps);
      const all = cat.categories.flatMap((c) => c.connectors);
      assert.deepEqual(all.filter((c) => c.available).map((c) => c.id), ["local_folder"]);
      assert.equal(await code(connect(deps, ana, { connectorId: "slack", name: "Slack", config: {}, permissions: { write: true } })), "connector_unavailable");
      assert.equal(await code(connect(deps, ana, { connectorId: "local_folder", name: "Docs", config: { path: folder }, permissions: {} })), "ok");
    });

    test("leitura autorizada: lista e importa para o Cérebro, com trilha", async () => {
      const { deps, folder, knowledge } = await setup();
      const c = await connect(deps, ana, { connectorId: "local_folder", name: "Documentos", config: { path: folder }, permissions: { read: true } });
      const id = c.id as ConnectionId;
      assert.deepEqual((await listFiles(deps, ana, id)).files.map((f) => [f.name, f.media_type]), [["politica-compras.md", "text/markdown"]]);
      const { source } = await importFile(deps, ana, id, { file: "politica-compras.md" });
      assert.equal(source.title, "politica-compras");
      assert.equal((await listSources(knowledge, ana)).sources.length, 1);
      const history = (await viewConnection(deps, id)).history.map((h) => h.kind);
      assert.deepEqual(history, ["connection_created", "file_imported"]);
    });

    test("ação não autorizada é recusada e registrada; desconectar bloqueia tudo", async () => {
      const { deps, folder } = await setup();
      const c = await connect(deps, ana, { connectorId: "local_folder", name: "Documentos", config: { path: folder }, permissions: { read: true } });
      const id = c.id as ConnectionId;
      assert.equal(await code(exportDeliverable(deps, ana, id, { deliverableId: "d-aceita", version: 1 })), "permission_denied");
      assert.ok(!readdirSync(folder).some((f) => f.startsWith("entrega")), "nada foi escrito");
      await changeConnection(deps, ana, id, { active: false });
      assert.equal(await code(listFiles(deps, ana, id)), "connection_disconnected");
      const blocked = (await viewConnection(deps, id)).history.filter((h) => h.kind === "action_blocked");
      assert.deepEqual(blocked.map((b) => (b.detail as { action: string; reason: string }).reason), ["permission_denied", "connection_disconnected"]);
      await changeConnection(deps, ana, id, { active: true });
      assert.equal((await listFiles(deps, ana, id)).files.length, 1, "reconectar confere a pasta e volta a ler");
    });

    test("escrita autorizada: só a versão aceita sai; não sobrescreve", async () => {
      const { deps, folder } = await setup();
      const c = await connect(deps, ana, { connectorId: "local_folder", name: "Saída", config: { path: folder }, permissions: { write: true } });
      const id = c.id as ConnectionId;
      assert.equal(await code(listFiles(deps, ana, id)), "permission_denied", "escrita não dá leitura");
      assert.equal((await exportDeliverable(deps, ana, id, { deliverableId: "d-aceita", version: 1 })).file, "entrega-d-aceita-v1.md");
      assert.equal((await exportDeliverable(deps, ana, id, { deliverableId: "d-aceita", version: 1 })).file, "entrega-d-aceita-v1 (2).md");
      assert.equal(await code(exportDeliverable(deps, ana, id, { deliverableId: "d-em-revisao", version: 1 })), "deliverable_not_accepted");
      assert.equal(readFileSync(join(folder, "entrega-d-aceita-v1.md"), "utf8"), "# Entrega d-aceita");
      await changeConnection(deps, ana, id, { permissions: { write: false } });
      assert.equal(await code(exportDeliverable(deps, ana, id, { deliverableId: "d-aceita", version: 1 })), "permission_denied", "tirar a permissão vale na hora");
    });

    test("HTTP: conectar, ações e recusas com status certos", async () => {
      const { deps, folder } = await setup();
      const app = await createHttpApp({ origin: () => "http://127.0.0.1:1", actor: () => ana, modules: [integrationsHttp(deps)] });
      cleanups.push(() => app.close());
      const call = (method: "GET" | "POST", url: string, payload?: object) => app.inject({ method, url, payload, headers: { host: "127.0.0.1:1" } });
      const created = await call("POST", "/api/integrations", { connector_id: "local_folder", name: "Docs", config: { path: folder }, permissions: { read: true } });
      assert.equal(created.statusCode, 201);
      const id = created.json().id;
      assert.equal((await call("GET", `/api/integrations/${id}/files`)).json().files.length, 1);
      const denied = await call("POST", `/api/integrations/${id}/export`, { deliverable_id: "d-aceita", version: 1 });
      assert.deepEqual([denied.statusCode, denied.json().code], [403, "permission_denied"]);
      assert.equal((await call("POST", `/api/integrations/${id}/import`, { file: "../fora.md" })).json().code, "invalid_file_name");
      assert.equal((await call("POST", "/api/integrations", { connector_id: "local_folder", name: "X", config: { path: folder }, permissions: { read: true }, extra: 1 })).statusCode, 400);
    });
  });
}
