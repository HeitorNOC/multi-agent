const assert = require("node:assert/strict");
const { once } = require("node:events");
const { spawn } = require("node:child_process");
const { createServer } = require("node:http");
const { randomUUID } = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { chromium } = require("../.tools/aurora-browser/node_modules/playwright-core");

async function main() {
  const catalog = JSON.parse(fs.readFileSync("demo-enterprise/catalog.json", "utf8"));
  const calls = [];
  const backend = createServer(async (req, res) => {
    let body = "";
    for await (const chunk of req) body += chunk;
    calls.push(JSON.parse(body).action);
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({
      phase: "ready", scenarios: catalog.scenarios, catalog: catalog.agents,
      sources: [], usage: { calls: 40, max_calls: 40 },
    }));
  });
  backend.listen(0, "127.0.0.1");
  await once(backend, "listening");
  const root = process.cwd();
  const state = path.join(root, "validation/aurora-engineering/.state", "que-panel-" + randomUUID());
  const api = spawn(process.execPath, ["packages/aurora-api/server.ts"], {
    windowsHide: true, stdio: ["pipe", "pipe", "inherit"],
  });
  const ready = new Promise((resolve, reject) => {
    let text = "";
    api.stdout.on("data", (chunk) => {
      text += chunk;
      if (text.includes("\n")) resolve(JSON.parse(text.split("\n")[0]).url);
    });
    api.once("exit", (code) => reject(new Error("API exited " + code)));
  });
  api.stdin.end(JSON.stringify({
    state, root, uiDir: path.join(root, "demo-enterprise"),
    backend: "http://127.0.0.1:" + backend.address().port,
    token: "repository-review-fixture", queueCapacity: 8, resumeReserve: 2,
    policyModule: pathToFileURL(path.join(root, "apps/aurora/domain/policy.ts")).href,
  }));
  let browser;
  try {
    const url = await ready;
    browser = await chromium.launch({
      executablePath: "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
      headless: true,
    });
    const page = await browser.newPage();
    await page.goto(url);
    await page.getByRole("button", { name: /Revisar entrega do que/ }).click();
    const [admission] = await Promise.all([
      page.waitForResponse((response) => response.url() === url + "/api/jobs" && response.request().method() === "POST"),
      page.getByRole("button", { name: /Abrir entrega para revisão/ }).click(),
    ]);
    assert.equal(admission.status(), 201);
    const { id } = await admission.json();
    const load = async () => (await (await page.request.get(url + "/api/state")).json()).jobs.find((job) => job.id === id);
    const job = await load();
    const report = job.review.report;
    assert.equal(job.status, "awaiting_approval");
    assert.equal(job.receipt, null);
    assert.equal(report.repository.revision, "5cf77950e29c0d203b3ee1d10471b775f6b91af4");
    assert.equal(report.tests.evidence.suite.passed_tests, 12);
    const patch = fs.readFileSync("reports/aurora-engenharia-webhook/que/que.patch", "utf8");
    assert.equal(report.diff, patch.replaceAll("\r\n", "\n"));
    const post = (route, data) => page.request.post(url + route, { data });
    const repeat = await post("/api/jobs", { scenario: "engineering_que_review" });
    assert.equal(repeat.status(), 200);
    assert.equal((await repeat.json()).id, id);
    const approval = "/api/jobs/" + id + "/approve";
    assert.equal((await post(approval, { hash: "errado" })).status(), 409);
    assert.equal((await post("/api/jobs/" + id + "/resume", {})).status(), 409);
    const panel = page.getByRole("region", { name: "Delegação de engenharia" });
    await panel.getByText(report.repository.revision).waitFor();
    await panel.getByText(/Autorizado.*disponível/).waitFor();
    await panel.getByText(/Testes da tentativa/).click();
    await panel.getByText(/12 testes passaram/).waitFor();
    await panel.getByText("Diff da entrega").click();
    await panel.locator("pre").filter({ hasText: /skips the unit of work/ }).waitFor();
    await page.getByRole("button", { name: "Registrar aprovação" }).click();
    await page.getByText(/Revisão registrada/).first().waitFor();
    const approved = await load();
    assert.equal(approved.status, "completed");
    assert.equal(approved.receipt.hash, job.review.hash);
    assert.equal(approved.receipt.recipient, "registro-local-engenharia");
    const replay = await post(approval, { hash: job.review.hash });
    assert.equal((await replay.json()).receipt.id, approved.receipt.id);
    assert.equal(approved.events.filter((event) => event.node === "human_approved").length, 1);
    assert.ok(calls.every((action) => action === "status"));
    if (process.argv[2]) {
      fs.writeFileSync(process.argv[2], JSON.stringify({
        revision: report.repository.revision, status: approved.status,
        review_hash: job.review.hash, receipt: approved.receipt, events: approved.events,
      }, null, 2) + "\n");
    }
    console.log("PASS: revisão pelo Edge, hash divergente recusado, recibo estável e zero chamadas de execução");
  } finally {
    if (browser) await browser.close();
    api.kill();
    backend.close();
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
