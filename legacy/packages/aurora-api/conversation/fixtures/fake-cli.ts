// CLI falsa para testes do cliente de modelo. Uso: node fake-cli.ts <claude|codex> <modo> <relatorio.json> [args da CLI...]
// Grava o que recebeu (argumentos, chaves de ambiente, stdin, diretório) e responde conforme o modo.
import { writeFileSync } from "node:fs";

const [flavor, mode, reportPath, ...cliArgs] = process.argv.slice(2);
let stdin = "";
for await (const chunk of process.stdin) stdin += chunk;
writeFileSync(reportPath, JSON.stringify({ args: cliArgs, envKeys: Object.keys(process.env), stdin, cwd: process.cwd() }));

const decision = { kind: "open_job", offer_id: "campaign", text: "Abri o trabalho." };
if (mode === "hang") setInterval(() => {}, 1000);
else if (mode === "exit1") process.exit(1);
else if (mode === "garbage") process.stdout.write("isto não é json");
else if (mode === "big") process.stdout.write("x".repeat(1_100_000));
else if (mode === "quota" && flavor === "codex") {
  // Formato real observado no codex-cli 0.149 quando a assinatura atinge o limite.
  const message = "You've hit your usage limit. Upgrade to Pro or try again later.";
  process.stdout.write([{ type: "turn.started" }, { type: "error", message }, { type: "turn.failed", error: { message } }].map((e) => JSON.stringify(e)).join("\n") + "\n");
  process.exit(1);
} else if (mode === "quota") {
  process.stdout.write(JSON.stringify({ type: "result", is_error: true, result: "Claude AI usage limit reached" }));
  process.exit(1);
}
else if (flavor === "claude")
  process.stdout.write(
    JSON.stringify({
      type: "result",
      is_error: false,
      structured_output: decision,
      usage: { input_tokens: 12, output_tokens: 7, server_tool_use: { web_search_requests: 0 }, service_tier: "standard" },
    }),
  );
else
  process.stdout.write(
    [
      { type: "thread.started" },
      { type: "item.completed", item: { type: "reasoning", text: "..." } },
      { type: "item.completed", item: { type: "agent_message", text: JSON.stringify(decision) } },
      { type: "turn.completed", usage: { input_tokens: 20, output_tokens: 9 } },
    ]
      .map((e) => JSON.stringify(e))
      .join("\n") + "\n",
  );
