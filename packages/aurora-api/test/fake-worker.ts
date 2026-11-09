// Worker falso para testes: o comportamento vem de WORKER_MODE (herdado do servidor).
let input = "";
for await (const c of process.stdin) input += c;
const mode = process.env.WORKER_MODE || "ok";
if (mode === "hang") setInterval(() => {}, 1000);
else if (mode === "fail") process.exit(1);
else if (mode === "crash88") process.exit(88);
else if (mode === "slow") {
  await new Promise((r) => setTimeout(r, 600));
  console.log(JSON.stringify({ completed: false }));
} else console.log(JSON.stringify({ completed: false }));
void input;
