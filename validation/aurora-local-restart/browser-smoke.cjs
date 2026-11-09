const assert = require("node:assert/strict");
const fs = require("node:fs");
const {
  chromium,
} = require("../.tools/aurora-browser/node_modules/playwright-core");

const catalog = JSON.parse(
  fs.readFileSync("demo-enterprise/catalog.json", "utf8"),
);
const corpus = JSON.parse(
  fs.readFileSync("demo-enterprise/corpus.json", "utf8"),
);
const director = catalog.agents.find((agent) => agent.kind === "director");
const finance = catalog.agents.find((agent) => agent.id === "finance_director");
const financialSpecialist = finance.children[0];
const [first, second] = director.children;
const startedAt = Date.now() - 8_000;
const at = (offset) => new Date(startedAt + offset).toISOString();
const trace = {
  job_id: "demo",
  trace_id: "browser-fixture",
  events: [
    {
      event_id: "started",
      kind: "inference_requested",
      worker_run_id: "run",
      model_slot: "plan",
      occurred_at: "2026-11-06T12:00:00.000Z",
    },
    {
      event_id: "ended",
      kind: "inference_completed",
      worker_run_id: "run",
      model_slot: "plan",
      occurred_at: "2026-11-06T12:00:02.400Z",
      evidence: [],
      fact_ids: [],
    },
  ],
};
const state = {
  runtime: {
    phase: "ready",
    catalog: catalog.agents,
    scenarios: catalog.scenarios,
    sources: corpus.documents.filter((doc) => doc.current),
    history: corpus.documents.filter((doc) => !doc.current),
    usage: { calls: 6, max_calls: 40, input_tokens: 8500, output_tokens: 1340 },
  },
  queue: { pending: 2, capacity: 32, running: 1, max_workers: 2 },
  performance: {
    hostCpuPercent: 17.2,
    sampledAt: "2026-11-06T12:00:03.000Z",
    hostMemoryUsedBytes: 8 * 1024 ** 3,
    hostMemoryTotalBytes: 16 * 1024 ** 3,
    apiResidentBytes: 90 * 1024 ** 2,
  },
  jobs: [
    {
      id: "demo",
      status: "running",
      worker_active: true,
      goal: catalog.scenarios[0].goal,
      plan: {
        capabilities: [
          director.id,
          first,
          second,
          finance.id,
          financialSpecialist,
        ],
        reason: "Demonstração da interface com dados de teste.",
        teams: [
          {
            lead: director.id,
            specialists: [first, second],
            reason: "Equipe selecionada para a simulação.",
          },
          {
            lead: finance.id,
            specialists: [financialSpecialist],
            reason: "Avaliar o impacto financeiro.",
          },
        ],
      },
      events: [
        {
          seq: 1,
          node: "job_dequeued",
          at: at(0),
          detail: { wait_ms: 900 },
        },
        {
          seq: 2,
          node: "worker_started",
          at: at(100),
          detail: {},
        },
        {
          seq: 3,
          node: "specialist_started",
          at: at(200),
          detail: { capability: first },
        },
        {
          seq: 4,
          node: "specialist_completed",
          at: at(2_000),
          detail: { capability: second, output: {} },
        },
        {
          seq: 5,
          node: "inference_requested",
          at: at(2_400),
          detail: { capability: first },
        },
      ],
    },
  ],
};
const assets = {
  "/": ["demo-enterprise/index.html", "text/html"],
  "/app.js": ["demo-enterprise/dist/app.js", "application/javascript"],
  "/app.css": ["demo-enterprise/dist/app.css", "text/css"],
};

async function test() {
  const browser = await chromium.launch({
    executablePath:
      "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
    headless: true,
  });
  try {
    const page = await browser.newPage({
      viewport: { width: 1440, height: 1050 },
    });
    const errors = [];
    let pilotMode = false;
    let pilotSignedIn = false;
    let pilotTask = null;
    page.on("pageerror", (error) => errors.push(error.message));
    await page.route("https://aurora.test/**", async (route) => {
      const path = new URL(route.request().url()).pathname;
      const asset = assets[path];
      if (asset)
        return route.fulfill({
          body: fs.readFileSync(asset[0]),
          contentType: asset[1],
        });
      if (pilotMode) {
        if (path === "/api/pilot/login") {
          const credentials = route.request().postDataJSON();
          pilotSignedIn =
            credentials.id === "fixture" &&
            credentials.password === "fixture-only";
          return route.fulfill({
            status: pilotSignedIn ? 200 : 401,
            json: { ok: pilotSignedIn },
          });
        }
        if (path === "/api/state") {
          if (!pilotSignedIn)
            return route.fulfill({
              status: 401,
              json: { pilot: true, error: "Entre para acessar o piloto" },
            });
          return route.fulfill({
            json: {
              ...state,
              actor: { id: "fixture", role: "operator" },
              runtime: {
                ...state.runtime,
                pilot: true,
                sources: [],
                history: [],
                scenarios: [],
              },
              jobs: [],
            },
          });
        }
        if (path === "/api/jobs") {
          pilotTask = route.request().postDataJSON();
          return route.fulfill({ status: 202, json: { id: "pilot-fixture" } });
        }
        if (path === "/api/pilot/stop")
          return route.fulfill({ json: { stopping: true } });
      }
      const json =
        path === "/api/state"
          ? state
          : path === "/api/jobs/demo/trace"
            ? trace
            : { authenticated: false, reviewers: [] };
      return route.fulfill({ json });
    });
    await page.goto("https://aurora.test/");
    const map = page.getByRole("group", { name: /Mapa tridimensional/ });
    const monitor = page.getByRole("region", {
      name: "Monitoramento de desempenho",
    });
    await monitor.getByText("2,4 s", { exact: true }).waitFor();
    assert.equal(
      await map.locator(".spatial-node").count(),
      catalog.agents.length + 1,
    );
    assert.equal(await map.locator(".spatial-node.running").count(), 1);
    assert.equal(await map.locator(".spatial-node.done").count(), 1);
    const hub = map.getByRole("button", { name: "Cérebro · Chief of Staff" });
    const node = map.getByRole("button", {
      name: catalog.agents.filter((agent) => agent.kind === "director").at(-1)
        .title,
    });
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
    async function capture(path) {
      await page.evaluate(() => document.activeElement?.blur?.());
      const mapBox = await page.locator(".spatial-panel").boundingBox();
      const monitorBox = await monitor.boundingBox();
      const y = mapBox.y + (await page.evaluate(() => window.scrollY));
      await page.screenshot({
        path,
        fullPage: true,
        clip: {
          x: mapBox.x,
          y,
          width: mapBox.width,
          height: monitorBox.y + monitorBox.height - mapBox.y,
        },
      });
    }
    if (process.argv[2]) await capture(process.argv[2]);
    await page
      .getByRole("button", { name: "Conhecimento", exact: true })
      .click();
    const knowledgeMap = page.getByRole("group", {
      name: "Mapa tridimensional do acervo por área",
    });
    assert.equal(
      await knowledgeMap.locator(".spatial-node.historical").count(),
      1,
    );
    assert.equal(await knowledgeMap.locator(".spatial-node.done").count(), 16);
    await page
      .getByRole("combobox", { name: "Inspecionar documento" })
      .selectOption("aurora-pricing:1");
    await page
      .getByText("Original · aurora-pricing v1", { exact: true })
      .waitFor();
    assert.equal(
      await knowledgeMap.locator(".historical").getAttribute("aria-pressed"),
      "true",
    );
    if (process.argv[3]) await capture(process.argv[3]);
    const views = page.getByRole("group", {
      name: "Visualizações da execução",
    });
    await views.getByRole("button", { name: "Delegação" }).click();
    const flow = page.getByRole("region", { name: "Fluxo de delegação" });
    const directors = flow.locator(".delegation-node.director");
    assert.equal(await directors.count(), 2);
    assert.equal(await flow.locator(".delegation-node.specialist").count(), 3);
    const vertical = flow.getByRole("button", { name: /Vertical/ });
    await vertical.click();
    assert.equal(await flow.locator(".delegation-tree.vertical").count(), 1);
    async function center(locator, axis) {
      const box = await locator.boundingBox();
      return axis === "x" ? box.x + box.width / 2 : box.y + box.height / 2;
    }
    async function verifyAlignment(axis) {
      const chief = await center(flow.locator(".chief"), axis);
      const offsets = [];
      for (const director of await directors.all()) {
        offsets.push((await center(director, axis)) - chief);
      }
      assert.ok(offsets[0] < 0);
      assert.ok(Math.abs(offsets[0] + offsets.at(-1)) < 1);
      if (offsets.length === 3) assert.ok(Math.abs(offsets[1]) < 1);
    }
    await verifyAlignment("x");
    const horizontal = flow.getByRole("button", { name: /Horizontal/ });
    await horizontal.click();
    assert.equal(await horizontal.getAttribute("aria-pressed"), "true");
    assert.equal(await flow.locator(".delegation-tree.horizontal").count(), 1);
    await verifyAlignment("y");
    const specialists = await Promise.all(
      [first, second].map((id) =>
        center(flow.locator(`[data-agent="${id}"]`), "y"),
      ),
    );
    assert.ok(
      Math.abs(
        (specialists[0] + specialists[1]) / 2 -
          (await center(directors.first(), "y")),
      ) < 1,
    );
    const specialist = catalog.agents.find((agent) => agent.id === first);
    const flowAgent = flow.getByRole("button", {
      name: new RegExp(specialist.title),
    });
    await flowAgent.click();
    assert.equal(await flowAgent.getAttribute("aria-pressed"), "true");
    if (process.argv[4]) await flow.screenshot({ path: process.argv[4] });
    const third = catalog.agents.find(
      (agent) =>
        agent.kind === "director" &&
        ![director.id, finance.id].includes(agent.id),
    );
    state.jobs[0].plan.teams.push({
      lead: third.id,
      specialists: [third.children[0]],
      reason: "Acompanhar o impacto na área.",
    });
    state.jobs[0].plan.capabilities.push(third.id, third.children[0]);
    await directors.nth(2).waitFor();
    await verifyAlignment("y");
    if (process.argv[6]) await flow.screenshot({ path: process.argv[6] });
    await vertical.click();
    await verifyAlignment("x");
    await views.getByRole("button", { name: "Lista operacional" }).click();
    const list = page.getByRole("region", {
      name: "Lista operacional de agentes",
    });
    assert.equal(
      await list.locator("tbody tr").count(),
      catalog.agents.length + 1,
    );
    const row = list.getByRole("row").filter({ hasText: specialist.title });
    assert.match(
      await row.innerText(),
      /Em execução.*Aguardando resposta do modelo.*1\/3.*Histórico insuficiente/s,
    );
    assert.equal(
      await row.getByRole("button").getAttribute("aria-pressed"),
      "true",
    );
    if (process.argv[5]) await list.screenshot({ path: process.argv[5] });
    await page.setViewportSize({ width: 390, height: 844 });
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
      true,
    );
    await views.getByRole("button", { name: "Delegação" }).click();
    assert.equal(await flow.locator(".delegation-tree.vertical").count(), 1);
    await verifyAlignment("x");
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
      true,
    );
    const operations = page.getByRole("region", {
      name: "Visão operacional da sessão",
    });
    await operations
      .getByText("Analista de negócios · Inferência solicitada")
      .waitFor();
    state.jobs.push(
      {
        id: "pending-review",
        goal: catalog.scenarios[1].goal,
        status: "awaiting_approval",
        worker_active: false,
        events: [],
      },
      {
        id: "pending-recovery",
        goal: catalog.scenarios[0].goal,
        status: "recovery_required",
        worker_active: false,
        events: [],
      },
    );
    await operations.getByText("Conciliação de inferência").waitFor();
    await operations.getByRole("button", { name: "Abrir parecer" }).click();
    await page.waitForFunction(
      () => document.activeElement?.id === "job-decision",
    );
    assert.match(
      await page.locator("#job-decision").innerText(),
      /Aguardando sua decisão/,
    );
    await operations.getByRole("button", { name: "Abrir recuperação" }).click();
    await page.waitForFunction(
      () => document.activeElement?.id === "job-recovery",
    );
    const theme = operations.getByRole("button", { name: "Tema claro" });
    await theme.click();
    assert.equal(await operations.getAttribute("data-theme"), "light");
    if (process.env.AURORA_OPERATIONS_SCREENSHOT) {
      await page.setViewportSize({ width: 1280, height: 900 });
      await operations.screenshot({
        path: process.env.AURORA_OPERATIONS_SCREENSHOT,
        animations: "disabled",
      });
    }
    await theme.click();
    assert.equal(await operations.getAttribute("data-theme"), "dark");
    if (process.env.AURORA_OPERATIONS_DARK_SCREENSHOT) {
      await operations.screenshot({
        path: process.env.AURORA_OPERATIONS_DARK_SCREENSHOT,
        animations: "disabled",
      });
    }
    state.jobs.unshift({
      id: "engineering",
      goal: catalog.scenarios.find((item) => item.id === "engineering_webhook").goal,
      status: "awaiting_approval",
      worker_active: false,
      events: [
        { seq: 1, node: "engineering_chief", detail: { roster: ["backend_engineer", "platform_engineer"] } },
        { seq: 2, node: "engineering_assign", detail: { assignments: [{ agent: "backend_engineer", task: "Implementar idempotência" }] } },
        { seq: 3, node: "engineering_qa", detail: { attempt: 1, tests: { passed: true, log: "CHECK duplicate" } } },
      ],
      review: { hash: "engineering-hash", payload: { content: "Registrar revisão humana" }, report: { kind: "engineering", qa: { verdict: "pass" }, technical_review: { verdict: "pass" }, diff: "--- a/webhook.cjs\n+++ b/webhook.cjs" } },
    });
    await page.reload();
    const engineering = page.getByRole("region", { name: "Delegação de engenharia" });
    await engineering.getByText(/Acionado.*Implementar idempotência/).waitFor();
    await engineering.getByText(/Autorizado.*disponível/).waitFor();
    await engineering.getByText(/Testes da tentativa 1.*Passaram/).click();
    await engineering.getByText("CHECK duplicate").waitFor();
    await engineering.getByText("Diff da entrega").click();
    await engineering.getByText(/a\/webhook.cjs/).waitFor();
    await page.getByRole("heading", { name: "Revisar entrega de engenharia" }).waitFor();

    pilotMode = true;
    await page.reload();
    await page.getByLabel("Identidade local").fill("fixture");
    await page.getByLabel("Senha").fill("fixture-only");
    await page.getByRole("button", { name: "Entrar", exact: true }).click();
    await page
      .getByLabel("Tarefa consultiva")
      .fill("Qual é o prazo de reembolso?");
    await page.getByRole("button", { name: /Pedir ao Chief/ }).click();
    await page.waitForResponse(
      (response) => response.url().endsWith("/api/state") && response.ok(),
    );
    assert.deepEqual(pilotTask, { goal: "Qual é o prazo de reembolso?" });
    state.queue = { ...state.queue, pending: 0, running: 0 };
    await page
      .getByRole("button", { name: "Encerrar e apagar sessão" })
      .click();
    await page
      .getByRole("heading", { name: "Encerramento do piloto solicitado" })
      .waitFor();
    assert.deepEqual(errors, []);
    console.log(
      "PASS: Edge desktop and mobile, mapa 3D, acervo, delegação em duas direções, lista operacional e p95",
    );
  } finally {
    await browser.close();
  }
}

test().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
