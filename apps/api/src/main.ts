/**
 * Ponto de entrada da API: lê a configuração, monta as peças e escuta em loopback.
 *
 *   node src/main.ts            (variáveis AURORA_* no ambiente; veja config.ts)
 *
 * Imprime uma linha JSON `{"ready":true,"url":...}` quando está pronta para receber pedidos.
 */
import { fileURLToPath } from "node:url";
import { ConfigError, loadConfig, type Config } from "./config.ts";
import { ClaudeCliClient, CodexCliClient } from "./platform/model/cli-clients.ts";
import type { ModelClient } from "./platform/model/model-client.ts";
import { loadTemplates } from "./modules/agents/domain/template.ts";
import { startServer } from "./server.ts";

/** Personas prontas que acompanham o produto. */
const DEFAULT_TEMPLATES = fileURLToPath(new URL("../data/agent-templates.json", import.meta.url));

function modelClient(model: Config["model"]): ModelClient | null {
  const options = { model: model.name, command: model.command };
  if (model.provider === "claude") return new ClaudeCliClient(options);
  if (model.provider === "codex") return new CodexCliClient(options);
  return null;
}

async function main() {
  const config = loadConfig();
  const server = await startServer(config, {
    templates: loadTemplates(config.templatesPath ?? DEFAULT_TEMPLATES),
    model: modelClient(config.model),
  });
  console.log(JSON.stringify({ ready: true, url: server.url }));
  let closing = false;
  const shutdown = () => {
    if (closing) return;
    closing = true;
    void server.close().then(() => process.exit(0));
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((error) => {
  console.error(error instanceof ConfigError ? error.message : error);
  process.exit(1);
});
