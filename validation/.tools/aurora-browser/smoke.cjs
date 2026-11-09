const assert = require("node:assert/strict");
const fs = require("node:fs");
const { chromium } = require("./node_modules/playwright-core");

const catalog = JSON.parse(fs.readFileSync("demo-enterprise/catalog.json", "utf8"));
const corpus = JSON.parse(fs.readFileSync("demo-enterprise/corpus.json", "utf8"));
const director = catalog.agents.find((agent) => agent.kind === "director");
const [first, second] = director.children;
const trace = {
  job_id: "demo",
  trace_id: "browser-fixture",
  events: [
    { event_id: "started", kind: "inference_requested", worker_run_id: "run", model_slot: "plan", occurred_at: "2026-11-06T12:00:00.000Z" },
    { event_id: "ended", kind: "inference_completed", worker_run_id: "run", model_slot: "plan", occurred_at: "2026-11-06T12:00:02.400Z", evidence: [], fact_ids: [] },
  ],
};
const state = {
  runtime: { phase: "ready", catalog: catalog.agents, scenarios: catalog.scenarios, sources: corpus.documents.filter((doc) => doc.current), usage: { calls: 6, max_calls: 40, input_tokens: 8500, output_tokens: 1340 } },
  queue: { pending: 2, capacity: 32, running: 1, max_workers: 2 },
  performance: { hostCpuPercent: 17.2, sampledAt: "2026-11-06T12:00:03.000Z", hostMemoryUsedBytes: 8 * 1024 ** 3, hostMemoryTotalBytes: 16 * 1024 ** 3, apiResidentBytes: 90 * 1024 ** 2 },
  jobs: [{
    id: "demo",
    status: "running",
    worker_active: true,
    goal: catalog.scenarios[0].goal,
    plan: { capabilities: [director.id, first, second], reason: "Demonstração da interface com dados de teste.", teams: [{ lead: director.id, specialists: [first, second], reason: "Equipe selecionada para a simulação." }] },
    events: [
      { seq: 1, node: "job_dequeued", at: "2026-11-06T12:00:00Z", detail: { wait_ms: 900 } },
      { seq: 2, node: "worker_started", at: "2026-11-06T12:00:00Z", detail: {} },
      { seq: 3, node: "specialist_started", at: "2026-11-06T12:00:00Z", detail: { capability: first } },
      { seq: 4, node: "specialist_completed", at: "2026-11-06T12:00:02Z", detail: { capability: second, output: {} } },
    ],
  }],
};
const assets = {
  "/": ["demo-enterprise/index.html", "text/html"],
  "/app.js": ["demo-enterprise/dist/app.js", "application/javascript"],
  "/app.css": ["demo-enterprise/dist/app.css", "text/css"],
};

async function test() {
  const browser = await chromium.launch({
    executablePath: "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
    headless: true,
  });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1050 } });
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.route("https://aurora.test/**", async (route) => {
      const path = new URL(route.request().url()).pathname;
      const asset = assets[path];
      if (asset) return route.fulfill({ body: fs.readFileSync(asset[0]), contentType: asset[1] });
      const json = path === "/api/state" ? state : path === "/api/jobs/demo/trace" ? trace : { authenticated: false, reviewers: [] };
      return route.fulfill({ json });
    });
    await page.goto("https://aurora.test/");
    const map = page.getByRole("group", { name: /Mapa tridimensional/ });
    const monitor = page.getByRole("region", { name: "Monitoramento de desempenho" });
    await monitor.getByText("2,4 s", { exact: true }).waitFor();
    assert.equal(await map.locator(".spatial-node").count(), 22);
    assert.equal(await map.locator(".spatial-node.running").count(), 1);
    assert.equal(await map.locator(".spatial-node.done").count(), 1);
    const hub = map.getByRole("button", { name: "Cérebro · Chief of Staff" });
    const node = map.getByRole("button", { name: catalog.agents.filter((agent) => agent.kind === "director").at(-1).title });
    const original = await node.getAttribute("transform");
    await page.getByRole("button", { name: "Girar à direita" }).click();
    assert.notEqual(await node.getAttribute("transform"), original);
    const rotated = await node.getAttribute("transform");
    const box = await map.boundingBox();
    await page.mouse.move(box.x + 25, box.y + 60);
    await page.mouse.down();
    await page.mouse.move(box.x + 110, box.y + 85, { steps: 8 });
    await page.mouse.up();
    assert.notEqual(await node.getAttribute("transform"), rotated);
    await page.getByRole("button", { name: "Ampliar mapa" }).click();
    await page.getByRole("button", { name: "Recentrar" }).click();
    assert.equal(await node.getAttribute("transform"), original);
    await node.focus();
    await node.press("Space");
    assert.equal(await node.getAttribute("aria-pressed"), "true");
    await hub.focus();
    await hub.press("Enter");
    assert.equal(await hub.getAttribute("aria-pressed"), "true");
    if (process.argv[2]) {
      const mapBox = await page.locator(".spatial-panel").boundingBox();
      const monitorBox = await monitor.boundingBox();
      const y = mapBox.y + await page.evaluate(() => window.scrollY);
      await page.screenshot({ path: process.argv[2], clip: { x: mapBox.x, y, width: mapBox.width, height: monitorBox.y + monitorBox.height - mapBox.y } });
    }
    await page.setViewportSize({ width: 390, height: 844 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
    assert.deepEqual(errors, []);
    console.log("PASS: Edge desktop and mobile, 22 nodes, rotation, drag, zoom, reset, keyboard selection, states, and recorded p95");
  } finally {
    await browser.close();
  }
}

test().catch((error) => { console.error(error); process.exitCode = 1; });
