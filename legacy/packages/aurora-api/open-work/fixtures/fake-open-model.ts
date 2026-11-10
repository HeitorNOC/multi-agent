// Modelo falso para testes do trabalho aberto, no formato de saída do `claude -p --output-format json`.
// Uso: node fake-open-model.ts <modo> <arquivo-de-chamadas> [args da CLI...]
//   modo "ok:agenteA,agenteB"  → plano com esses agentes; especialistas e síntese citam trechos recebidos
//   modo "bad-plan"            → plano com agente inexistente
//   modo "bad-cite:..."        → especialista cita rótulo que não recebeu
//   modo "hang-specialist:..." → trava (até 30 s) na primeira tarefa de especialista
// Cada chamada acrescenta uma linha com a tarefa ao arquivo de chamadas.
import { appendFileSync } from "node:fs";

const [mode, callsFile] = process.argv.slice(2);
let stdin = "";
for await (const chunk of process.stdin) stdin += chunk;
const input = JSON.parse(stdin);
const task = "catalogo" in input ? "plan" : "achados" in input ? "synthesis" : "specialist";
appendFileSync(callsFile, task + "\n");

const [kind, arg = ""] = mode.split(":");
const reply = (value: unknown) => {
  process.stdout.write(JSON.stringify({ type: "result", is_error: false, structured_output: value, usage: { input_tokens: 10, output_tokens: 5 } }));
};

if (task === "plan") {
  reply(
    kind === "bad-plan"
      ? { agents: ["agente_inexistente"], reason: "Escolha inválida de propósito." }
      : { agents: arg.split(",").filter(Boolean), reason: "Os especialistas cobrem as áreas do pedido." },
  );
} else if (task === "specialist") {
  if (kind === "hang-specialist") {
    setTimeout(() => process.exit(1), 30_000);
  } else {
    const first = input.trechos[0];
    reply({
      findings: [{ claim: `A fonte "${first.fonte}" diz: ${first.texto.slice(0, 120)}`, citations: [kind === "bad-cite" ? "f-00000000" : first.rotulo] }],
      unknowns: [],
    });
  }
} else {
  const first = input.achados[0];
  reply({ abstain: false, summary: `Consolidação: ${first.afirmacao}`, recommendation: "Seguir a política vigente citada.", citations: [first.rotulos[0]] });
}
