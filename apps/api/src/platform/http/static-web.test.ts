import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { ActorId } from "../../shared/ids.ts";
import { createHttpApp } from "./app.ts";
import { staticWeb } from "./static-web.ts";

const dir = mkdtempSync(join(tmpdir(), "aurora-web-"));
after(() => rmSync(dir, { recursive: true, force: true }));
mkdirSync(join(dir, "dist", "assets"), { recursive: true });
writeFileSync(join(dir, "dist", "index.html"), "<!doctype html><div id=root></div>");
writeFileSync(join(dir, "dist", "assets", "app-abc.js"), "console.log(1)");
writeFileSync(join(dir, "segredo.txt"), "não deve sair");

test("serve a SPA: arquivos, volta para index.html, API intocada, nada fora da pasta", async () => {
  const app = await createHttpApp({ origin: () => "http://127.0.0.1:1", actor: () => ActorId.parse("x"), modules: [staticWeb(join(dir, "dist"))] });
  const get = (url: string) => app.inject({ method: "GET", url, headers: { host: "127.0.0.1:1" } });
  const asset = await get("/assets/app-abc.js");
  assert.deepEqual([asset.statusCode, asset.headers["content-type"], asset.headers["cache-control"]], [200, "text/javascript; charset=utf-8", "public, max-age=31536000, immutable"]);
  const page = await get("/trabalhos/123");
  assert.deepEqual([page.statusCode, page.headers["content-type"], page.body.includes("id=root")], [200, "text/html; charset=utf-8", true]);
  assert.equal(page.headers["cache-control"], "no-store");
  assert.deepEqual([(await get("/api/nada")).statusCode, (await get("/api/nada")).json().code], [404, "route_not_found"]);
  for (const evil of ["/../segredo.txt", "/%2e%2e/segredo.txt", "/assets/..%2f..%2fsegredo.txt"]) {
    const res = await get(evil);
    assert.ok(!res.body.includes("não deve sair"), evil);
  }
  await app.close();
});
