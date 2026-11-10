// Cria o ambiente Python do worker (apps/runtime/.venv) e instala as dependências fixadas.
// Funciona no Windows (Scripts\python.exe) e no Linux/macOS (bin/python).
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const runtime = fileURLToPath(new URL("../apps/runtime/", import.meta.url));
const venv = join(runtime, ".venv");
const python = process.platform === "win32" ? join(venv, "Scripts", "python.exe") : join(venv, "bin", "python");
const base = process.env.PYTHON ?? (process.platform === "win32" ? "python" : "python3");

if (!existsSync(python)) execFileSync(base, ["-m", "venv", venv], { stdio: "inherit" });
execFileSync(python, ["-m", "pip", "install", "--disable-pip-version-check", "-r", join(runtime, "requirements.txt")], { stdio: "inherit" });
console.log(`Ambiente pronto: ${python}`);
