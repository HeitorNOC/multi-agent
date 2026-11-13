// Cliente de modelo via CLI. Nenhuma conta real é usada: a CLI é um script falso.
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { after, test } from "node:test";
import { ClaudeCliClient, CodexCliClient, filteredEnv, parseClaudeOutput, parseCodexOutput } from "./cli-clients.ts";
import { CallLimiter } from "./call-limiter.ts";
import { ModelCallError, type ModelRequest } from "./model-client.ts";

const fake = fileURLToPath(new URL("../../../test/fixtures/fake-cli.ts", import.meta.url));
const dir = mkdtempSync(join(tmpdir(), "aurora-model-cli-"));
after(() => rmSync(dir, { recursive: true, force: true }));
let n = 0;
const reportFile = () => join(dir, `r${++n}.json`);
const request: ModelRequest = { system: "SISTEMA", prompt: '{"mensagem":"oi"}', schema: { type: "object" }, timeoutMs: 10_000 };
const client = (flavor: "claude" | "codex", mode: string, report: string, model?: string) => {
  const command = [process.execPath, fake, flavor, mode, report];
  return flavor === "claude" ? new ClaudeCliClient({ command, model }) : new CodexCliClient({ command, model });
};
const code = (p: Promise<unknown>) => p.then(() => "ok", (e) => (e instanceof ModelCallError ? e.code : String(e)));

test("Claude: flags de segurança, prompt por stdin, ambiente filtrado, diretório descartável", async () => {
  const report = reportFile();
  process.env.AURORA_SEGREDO_DE_TESTE = "nao-deve-vazar";
  try {
    const result = await client("claude", "ok", report, "modelo-x").complete(request);
    assert.equal(JSON.parse(result.json).offer_id, "campaign");
    assert.deepEqual(result.usage, { input_tokens: 12, output_tokens: 7 }, "só os contadores numéricos");
  } finally {
    delete process.env.AURORA_SEGREDO_DE_TESTE;
  }
  const seen = JSON.parse(readFileSync(report, "utf8"));
  for (const flag of ["-p", "--no-session-persistence", "--strict-mcp-config", "--json-schema", "--system-prompt"]) assert.ok(seen.args.includes(flag), flag);
  assert.equal(seen.args[seen.args.indexOf("--tools") + 1], "", "nenhuma ferramenta");
  assert.equal(seen.args[seen.args.indexOf("--model") + 1], "modelo-x");
  assert.equal(seen.stdin, request.prompt);
  assert.ok(!seen.envKeys.includes("AURORA_SEGREDO_DE_TESTE"), "segredos do Aurora não chegam à CLI");
  assert.ok(!existsSync(seen.cwd), "o diretório de trabalho é apagado depois");
});

test("Codex: sandbox somente leitura, sem shell, schema em arquivo, uso extraído dos eventos", async () => {
  const report = reportFile();
  const result = await client("codex", "ok", report).complete(request);
  assert.equal(JSON.parse(result.json).offer_id, "campaign");
  assert.deepEqual(result.usage, { input_tokens: 20, output_tokens: 9 });
  const seen = JSON.parse(readFileSync(report, "utf8"));
  assert.equal(seen.args[seen.args.indexOf("--sandbox") + 1], "read-only");
  assert.ok(seen.args.includes("features.shell_tool=false"));
  assert.ok(seen.args.includes("--ephemeral") && seen.args.includes("--ignore-user-config"));
  assert.ok(!seen.args.includes("--model"), "sem modelo configurado, usa o padrão da conta");
  assert.match(seen.stdin, /^SISTEMA\n\n\{"mensagem":"oi"\}$/);
});

test("imagens: Claude recebe mensagem estruturada em base64; Codex, arquivos descartáveis", async () => {
  const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);
  const withImage = { ...request, images: [{ mediaType: "image/png" as const, bytes: png }] };
  const c = reportFile();
  assert.equal(JSON.parse((await client("claude", "ok", c).complete(withImage)).json).offer_id, "campaign");
  const claude = JSON.parse(readFileSync(c, "utf8"));
  assert.ok(claude.args.join(" ").includes("--input-format stream-json --output-format stream-json --verbose"));
  const message = JSON.parse(claude.stdin.trim());
  assert.deepEqual(message.message.content.map((b: { type: string }) => b.type), ["image", "text"]);
  assert.equal(message.message.content[0].source.data, Buffer.from(png).toString("base64"));
  assert.equal(message.message.content[1].text, request.prompt);
  assert.deepEqual(claude.args.slice(claude.args.indexOf("--tools"), claude.args.indexOf("--tools") + 2), ["--tools", ""], "continua sem ferramentas");
  const x = reportFile();
  await client("codex", "ok", x).complete(withImage);
  const codex = JSON.parse(readFileSync(x, "utf8"));
  assert.deepEqual(codex.images, [png.length], "o Codex leu a imagem do arquivo");
  const file = codex.args[codex.args.indexOf("--image") + 1];
  assert.match(file, /imagem-1\.png$/);
  assert.equal(existsSync(file), false, "o arquivo some depois da chamada");
});

test("falhas viram códigos estáveis", async () => {
  assert.equal(await code(client("claude", "exit1", reportFile()).complete(request)), "nonzero_exit");
  assert.equal(await code(client("codex", "quota", reportFile()).complete(request)), "quota_exhausted");
  assert.equal(await code(client("claude", "quota", reportFile()).complete(request)), "quota_exhausted");
  assert.equal(await code(client("claude", "garbage", reportFile()).complete(request)), "invalid_output");
  assert.equal(await code(client("codex", "garbage", reportFile()).complete(request)), "message_count");
  assert.equal(await code(client("claude", "big", reportFile()).complete(request)), "output_too_large");
  assert.equal(await code(client("claude", "hang", reportFile()).complete({ ...request, timeoutMs: 500 })), "timeout");
  const missing = new ClaudeCliClient({ command: [join(dir, "nao-existe.exe")] });
  assert.equal(await code(missing.complete(request)), "executable_unavailable");
});

test("parsers: formatos alternativos e uso de ferramenta recusado", () => {
  assert.equal(parseClaudeOutput(JSON.stringify([{ type: "system" }, { type: "result", result: '{"a":1}' }])).json, '{"a":1}');
  assert.throws(() => parseClaudeOutput(JSON.stringify({ is_error: true })), /provider_reported_error/);
  assert.throws(() => parseClaudeOutput(JSON.stringify({ result: "  " })), /empty_output/);
  const tool = [{ type: "item.completed", item: { type: "command_execution" } }].map((e) => JSON.stringify(e)).join("\n");
  assert.throws(() => parseCodexOutput(tool), /unexpected_tool_use/);
});

test("ambiente filtrado mantém só o necessário", () => {
  assert.deepEqual(filteredEnv({ PATH: "p", APPDATA: "a", DATABASE_URL: "x", AURORA_TOKEN: "y", HOME: "h" }), { PATH: "p", APPDATA: "a", HOME: "h" });
});

test("limitador: excesso é recusado na hora, sem fila sem fim", async () => {
  const limiter = new CallLimiter(1, 1);
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  const first = limiter.tryRun(() => gate);
  const second = limiter.tryRun(async () => "segundo");
  assert.deepEqual(await limiter.tryRun(async () => "terceiro"), { busy: true });
  release();
  assert.equal((await first).busy, false);
  assert.deepEqual(await second, { busy: false, value: "segundo" });
});
