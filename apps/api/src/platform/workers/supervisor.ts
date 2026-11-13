/**
 * Supervisão dos processos de worker. Cada trabalho em execução tem um processo e uma concessão
 * (`lease`): o worker só é ouvido pela API interna enquanto a concessão dele for a atual.
 *
 * O supervisor não decide estados; quando o processo termina, ele relata o resultado bruto e a
 * aplicação decide (`finishRun`).
 */
import { spawn, type ChildProcess } from "node:child_process";
import { randomUUID, timingSafeEqual } from "node:crypto";
import type { JobId } from "../../shared/ids.ts";
import type { Json } from "../../shared/json.ts";
import type { RunResult } from "../../modules/jobs/application/run-lifecycle.ts";
import type { ActiveWorkers } from "../../modules/jobs/application/deps.ts";

export interface WorkerLaunch {
  jobId: JobId;
  goal: string;
  crashAfterEffect: boolean;
}

export interface SupervisorOptions {
  /** Executável e argumentos do worker (por exemplo, o Python do runtime e o script). */
  command: readonly string[];
  /** Diretório de trabalho do processo. */
  cwd?: string;
  /** Configuração extra entregue ao worker (por exemplo, a conexão dos checkpoints). */
  workerConfig?: Record<string, Json>;
  /** Endereço da API para o worker chamar de volta (conhecido só depois de escutar). */
  apiUrl: () => string;
  /** Segredo que o worker apresenta na API interna. */
  token: string;
  onExit: (jobId: JobId, result: RunResult) => Promise<void>;
}

const OUTPUT_TAIL = 200_000;

export class WorkerSupervisor implements ActiveWorkers {
  private readonly options: SupervisorOptions;
  private readonly running = new Map<JobId, { child: ChildProcess; lease: string }>();
  private stopping = false;

  constructor(options: SupervisorOptions) {
    this.options = options;
  }

  isActive(jobId: JobId) {
    return this.running.has(jobId);
  }

  count() {
    return this.running.size;
  }

  /** `true` se `token` é o segredo entregue aos workers. */
  acceptsToken(token: unknown): boolean {
    return typeof token === "string" && sameSecret(token, this.options.token);
  }

  /** `true` se `lease` é a concessão atual do worker deste trabalho. */
  holdsLease(jobId: JobId, lease: unknown): boolean {
    const current = this.running.get(jobId)?.lease;
    return !!current && typeof lease === "string" && sameSecret(lease, current);
  }

  start(launch: WorkerLaunch): void {
    if (this.stopping) throw new Error("Supervisor encerrando");
    const [executable, ...args] = this.options.command;
    if (!executable) throw new Error("Comando do worker não configurado");
    const lease = randomUUID();
    const child = spawn(executable, args, { cwd: this.options.cwd, windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
    this.running.set(launch.jobId, { child, lease });
    let output = "";
    let spawnFailed = false;
    child.stdout!.on("data", (chunk) => {
      output = (output + chunk).slice(-OUTPUT_TAIL);
    });
    child.stderr!.resume();
    child.stdin!.on("error", () => {});
    child.on("error", () => {
      spawnFailed = true;
    });
    child.on("close", (code) => {
      this.running.delete(launch.jobId);
      if (this.stopping) return;
      void this.options.onExit(launch.jobId, { exitCode: code, declared: lastDeclaration(output), spawnFailed });
    });
    child.stdin!.end(
      JSON.stringify({
        ...this.options.workerConfig,
        api: this.options.apiUrl(),
        token: this.options.token,
        job: launch.jobId,
        goal: launch.goal,
        model_lease: lease,
        crash_after_effect: launch.crashAfterEffect,
      }),
    );
  }

  /** Encerra os processos sem relatar resultado: o próximo início concilia como interrompidos. */
  stopAll() {
    this.stopping = true;
    for (const { child } of this.running.values()) child.kill();
  }
}

function sameSecret(given: string, expected: string): boolean {
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** A última linha JSON da saída do worker, se declarar `completed`. */
function lastDeclaration(output: string): { completed: boolean } | undefined {
  const line = output.trim().split("\n").at(-1);
  try {
    const value = JSON.parse(line ?? "");
    return typeof value?.completed === "boolean" ? { completed: value.completed } : undefined;
  } catch {
    return undefined;
  }
}
