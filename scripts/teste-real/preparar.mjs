// Prepara a empresa do teste real pela API (Aurora já rodando): alçadas, fatos e recursos.
// Só descrições: nenhuma senha ou token vai para o Aurora por aqui.
// Uso: node scripts/teste-real/preparar.mjs [http://localhost:4300]
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const base = process.argv[2] ?? "http://localhost:4300";

async function call(method, path, body) {
  const res = await fetch(base + path, { method, headers: body ? { "content-type": "application/json" } : {}, body: body ? JSON.stringify(body) : undefined });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${method} ${path}: ${res.status} ${JSON.stringify(data)}`);
  return data;
}

const facts = [
  ["empresa", "Empresa de software B2B com produto de atendimento ao cliente; time de engenharia de 12 pessoas."],
  ["tecnologia", "Backend em Node.js com TypeScript; serviços em contêiner no Kubernetes; PostgreSQL como banco principal."],
  ["tecnologia", "Mensageria entre serviços pelo Kafka; eventos em JSON com schema versionado."],
  ["regras", "Todo microserviço novo segue o padrão de microserviços do Cérebro e tem testes automatizados no CI."],
  ["regras", "Dados pessoais de clientes seguem a LGPD: finalidade explícita, retenção definida e exclusão a pedido."],
];
const resources = [
  ["database", "PostgreSQL de produção", "PostgreSQL 16 gerenciado, um banco por serviço; criação de banco novo pelo time de plataforma."],
  ["queue", "Kafka", "Cluster Kafka compartilhado; tópicos por domínio (ex.: atendimento.*); retenção padrão de 7 dias."],
  ["environment", "Kubernetes produção", "Cluster de produção com ingress NGINX; deploy por Helm a partir do CI."],
  ["repository", "GitHub da empresa", "Organização no GitHub; cada serviço em um repositório; CI com GitHub Actions."],
];

// Primeiro acesso: empresa, um diretor de tecnologia no time (o resto o Chief propõe) e o padrão
// de microserviços no Cérebro.
const org = await call("GET", "/api/organization");
if (!org.name) {
  await call("POST", "/api/organization", {
    name: "Empresa Teste",
    sector: "Software B2B de atendimento ao cliente",
    objectives: "Lançar o atendimento por WebChat como microserviço neste trimestre.",
  });
  console.log("empresa: Empresa Teste");
}
const team = await call("GET", "/api/agents");
if (!team.agents.some((a) => a.template_id === "director_technology")) {
  await call("POST", "/api/agents/hire", { template_id: "director_technology" });
  console.log("time: diretor de tecnologia");
}
const TITLE = "Padrão de microserviços";
const sources = await call("GET", "/api/knowledge/sources");
if (!sources.sources.some((s) => s.title === TITLE && !s.revoked_at)) {
  const text = readFileSync(fileURLToPath(new URL("padrao-microservicos.md", import.meta.url)), "utf8");
  await call("POST", "/api/knowledge/sources", { title: TITLE, text });
  console.log(`Cérebro: ${TITLE}`);
}
await call("POST", "/api/setup/complete");

const existing = await call("GET", "/api/resources");
const have = new Set(existing.resources.map((r) => r.name));
for (const [kind, name, description] of resources) {
  if (have.has(name)) continue;
  await call("POST", "/api/resources", { kind, name, description });
  console.log(`recurso: ${name}`);
}

const known = await call("GET", "/api/company/facts");
const texts = new Set((known.facts ?? []).map((f) => f.text));
for (const [category, text] of facts) {
  if (texts.has(text)) continue;
  await call("POST", "/api/company/facts", { category, text });
  console.log(`fato: ${text.slice(0, 60)}…`);
}

await call("POST", "/api/autonomy", { hire: "propose", engagement: "job", max_agents: 8 });
console.log("alçadas: contratar = propor, só neste trabalho, até 8 agentes");
console.log("\nPronto. Falta só o GitHub em Integrações (seção 4 do roteiro).");
