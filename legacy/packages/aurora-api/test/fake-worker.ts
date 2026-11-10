// Worker falso para testes: o comportamento vem de WORKER_MODE (herdado do servidor).
let input = "";
for await (const c of process.stdin) input += c;
const mode = process.env.WORKER_MODE || "ok";
/** Percorre a jornada pela API interna, como o worker real: plano → parecer → efeito. */
async function journey() {
  const c = JSON.parse(input);
  const call = async (path: string, body: object) => {
    const res = await fetch(c.api + path, {
      method: "POST",
      headers: { "content-type": "application/json", "x-demo-token": c.token },
      body: JSON.stringify({ job: c.job, model_lease: c.model_lease, ...body }),
    });
    const json = await res.json();
    if (!res.ok) throw new Error(`${path}: ${json.error}`);
    return json;
  };
  const { review, approval } = await call("/internal/snapshot", {});
  if (!review) {
    await call("/internal/plan", {
      plan: {
        strategy: "A3",
        capabilities: ["sales_analysis", "inventory_analysis"],
        reason: "Cruzar vendas e estoque do período.",
      },
    });
    await call("/internal/review", {
      report: {
        january_revenue: 10000,
        february_revenue: 8000,
        revenue_drop_pct: 20,
        january_stockouts: 0,
        february_stockouts: 0,
        causal_proof: false,
        summary: "Queda de 20% sem causa comprovada.",
        action: "Propor campanha de reativação.",
        hypotheses: ["sazonalidade"],
        cited_sources: ["sales-january", "sales-february", "inventory"],
        requires_approval: true,
      },
    });
    console.log(JSON.stringify({ completed: false }));
  } else if (approval) {
    await call("/internal/effect", { hash: review.hash });
    console.log(JSON.stringify({ completed: true }));
  } else process.exit(1);
}
if (mode === "journey") await journey();
else if (mode === "hang") setInterval(() => {}, 1000);
else if (mode === "fail") process.exit(1);
else if (mode === "crash88") process.exit(88);
else if (mode === "slow") {
  await new Promise((r) => setTimeout(r, 600));
  console.log(JSON.stringify({ completed: false }));
} else console.log(JSON.stringify({ completed: false }));
void input;
