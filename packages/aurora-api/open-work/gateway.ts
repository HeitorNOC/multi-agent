/**
 * Portão do trabalho aberto: o único caminho do worker até o conhecimento e o modelo.
 *
 * O worker (LangGraph) decide a ordem dos passos; o portão decide o que cada passo pode ler e
 * aceitar. Ele nunca confia em texto vindo do worker: o pedido, o catálogo, os trechos e as
 * saídas anteriores são relidos do ledger e do Cérebro, e o worker só envia rótulos.
 *
 * Cada chamada ao modelo tem um recibo no ledger:
 *  - reservada antes de chamar; recibo gravado depois;
 *  - repetir o mesmo passo devolve o recibo, sem chamar de novo (retomada barata e sem duplicar);
 *  - falha sabida (CLI com erro, saída recusada) libera a reserva para nova tentativa;
 *  - reserva sem recibo encontrada depois de uma queda = resultado desconhecido: não chama de
 *    novo; o trabalho vai para `recovery_required`.
 */
import { createHash } from "node:crypto";
import type { CallLimiter } from "../conversation/call-limiter.ts";
import { ModelCallError, type ModelClient } from "../conversation/model-cli.ts";
import { canonical } from "../ledger/event-codec.ts";
import type { JourneyLedger } from "../ledger/journey-ledger.ts";
import type { KnowledgeService } from "../knowledge/knowledge-service.ts";
import type { CatalogAgent } from "./catalog.ts";
import {
  planTask,
  specialistTask,
  synthesisTask,
  TaskOutputError,
  type Fragment,
  type SpecialistOutput,
  type TaskSpec,
} from "./tasks.ts";

export class OpenWorkError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "OpenWorkError";
    this.status = status;
    this.code = code;
  }
}

export interface OpenWorkDeps {
  ledger: JourneyLedger;
  knowledge: KnowledgeService;
  /** `null` quando a instalação não configurou modelo para o trabalho aberto. */
  client: ModelClient | null;
  limiter: CallLimiter;
  catalog: CatalogAgent[];
  now?: () => string;
  timeoutMs?: number;
}

const SLOT = /^(plan|synthesis|specialist:[a-z0-9_]{1,80})$/;
const LABEL = /^f-[0-9a-f]{8}$/;
const FRAGMENTS_PER_AGENT = 6;

const sha = (value: unknown) => createHash("sha256").update(canonical(value)).digest("hex");
/** Rótulo curto e estável de um trecho, fácil para o modelo copiar sem erro. */
export const labelOf = (passageId: string) => `f-${createHash("sha256").update(passageId).digest("hex").slice(0, 8)}`;

export class OpenWorkGateway {
  private readonly ledger: JourneyLedger;
  private readonly knowledge: KnowledgeService;
  private readonly client: ModelClient | null;
  private readonly limiter: CallLimiter;
  private readonly catalog: Map<string, CatalogAgent>;
  private readonly now: () => string;
  private readonly timeoutMs: number;

  constructor(deps: OpenWorkDeps) {
    this.ledger = deps.ledger;
    this.knowledge = deps.knowledge;
    this.client = deps.client;
    this.limiter = deps.limiter;
    this.catalog = new Map(deps.catalog.map((a) => [a.id, a]));
    this.now = deps.now ?? (() => new Date().toISOString());
    this.timeoutMs = deps.timeoutMs ?? 180_000;
  }

  get agents(): CatalogAgent[] {
    return [...this.catalog.values()];
  }

  /** Trechos do Cérebro para um especialista do plano; o que foi entregue fica na trilha do trabalho. */
  async retrieve(job: string, agentId: string) {
    const { goal, plan } = await this.job(job);
    if (!plan?.agents?.includes(agentId)) throw new OpenWorkError(409, "agent_not_in_plan", "Especialista fora do plano");
    const agent = this.catalog.get(agentId)!;
    const passages = await this.knowledge.retrieveForAgents(`${goal}\n${agent.focus}`, FRAGMENTS_PER_AGENT);
    const fragments = passages.map((p) => ({ ...p, label: labelOf(p.id) }));
    await this.ledger.appendEvent(job, "knowledge_retrieved", {
      agent: agentId,
      fragments: fragments.map((f) => ({ label: f.label, id: f.id, source: f.source, version: f.version })),
    });
    return {
      fragments: fragments.map((f) => ({
        label: f.label,
        source: f.source,
        title: f.title,
        version: f.version,
        valid_from: f.validFrom,
        url: f.url,
      })),
    };
  }

  /** Rótulos entregues a este trabalho, com o trecho de origem. */
  async retrievedLabels(job: string): Promise<Map<string, string>> {
    const labels = new Map<string, string>();
    for (const event of await this.ledger.listEvents(job)) {
      if (event.node !== "knowledge_retrieved") continue;
      for (const f of JSON.parse(event.detail).fragments) labels.set(f.label, f.id);
    }
    return labels;
  }

  /** Executa (ou repete pelo recibo) um passo de modelo do trabalho. */
  async run(job: string, slot: string, input: { labels?: unknown } = {}) {
    if (!SLOT.test(slot)) throw new OpenWorkError(400, "invalid_slot", "Passo inválido");
    if (!this.client) throw new OpenWorkError(503, "model_not_configured", "Modelo do trabalho aberto não configurado");
    const spec = await this.spec(job, slot, input);
    const inputSha = sha({ slot, prompt: spec.prompt, system: spec.system });

    const { created, record } = await this.ledger.reserveInference({ job, slot, inputSha, created: this.now() });
    if (!created) {
      if (record.inputSha !== inputSha)
        throw new OpenWorkError(409, "input_changed", "Este passo já foi executado com outra entrada");
      if (record.state === "completed") return { output: JSON.parse(record.output!), replayed: true };
      // Reserva sem recibo: a chamada pode ter acontecido antes de uma queda. Não repetir.
      await this.ledger.transaction(async (tx) => {
        await tx.updateJob(
          job,
          { status: "recovery_required", error: "Uma chamada ao modelo ficou sem recibo; revise antes de retomar." },
          { statusIn: ["running", "queued", "interrupted", "failed"] },
        );
        await tx.appendEvent(job, "inference_unknown", { slot });
      });
      throw new OpenWorkError(409, "inference_unknown", "Resultado de uma chamada ao modelo é desconhecido");
    }
    if (!(await this.withinBudget(job, slot))) {
      await this.ledger.releaseInference(job, slot);
      throw new OpenWorkError(429, "plan_call_limit", "Limite de chamadas ao modelo do plano atingido");
    }

    let output: unknown;
    let usage: Record<string, unknown> = {};
    try {
      const result = await this.limiter.tryRun(() =>
        this.client!.complete({ system: spec.system, prompt: spec.prompt, schema: spec.schema, timeoutMs: this.timeoutMs }),
      );
      if (result.busy) throw new ModelCallError("model_busy");
      output = spec.validate(result.value.json);
      usage = result.value.usage;
    } catch (error) {
      // Falha sabida: a CLI terminou ou a saída foi recusada. Libera para nova tentativa.
      const code = error instanceof ModelCallError || error instanceof TaskOutputError ? error.code : "model_error";
      await this.ledger.releaseInference(job, slot);
      await this.ledger.appendEvent(job, "inference_failed", { slot, code });
      throw new OpenWorkError(502, code, `Chamada ao modelo falhou: ${code}`);
    }
    await this.ledger.transaction(async (tx) => {
      await tx.completeInference(job, slot, JSON.stringify(output), JSON.stringify(usage), this.now());
      await tx.appendEvent(job, "inference_completed", { slot, usage, provider: this.client!.provider });
    });
    return { output, replayed: false };
  }

  /** Monta a tarefa a partir do ledger; o worker só indica o passo e, no especialista, os rótulos. */
  private async spec(job: string, slot: string, input: { labels?: unknown }): Promise<TaskSpec<unknown>> {
    const { goal, plan } = await this.job(job);
    if (slot === "plan") return planTask(goal, this.agents);
    if (!plan) throw new OpenWorkError(409, "plan_missing", "Plano ausente");
    if (slot === "synthesis") {
      const findings = [];
      for (const r of await this.ledger.listInferences(job)) {
        if (!r.slot.startsWith("specialist:") || r.state !== "completed") continue;
        const agent = r.slot.slice("specialist:".length);
        for (const f of (JSON.parse(r.output!) as SpecialistOutput).findings) findings.push({ agent, ...f });
      }
      const labels = [...new Set(findings.flatMap((f) => f.citations))];
      return synthesisTask(goal, findings, await this.fragments(job, labels));
    }
    const agentId = slot.slice("specialist:".length);
    if (!plan.agents.includes(agentId)) throw new OpenWorkError(409, "agent_not_in_plan", "Especialista fora do plano");
    const labels = input.labels;
    if (!Array.isArray(labels) || labels.length > FRAGMENTS_PER_AGENT || !labels.every((l) => typeof l === "string" && LABEL.test(l)))
      throw new OpenWorkError(400, "invalid_labels", "Rótulos inválidos");
    return specialistTask(goal, this.catalog.get(agentId)!, await this.fragments(job, labels as string[]));
  }

  /** Resolve rótulos entregues a este trabalho; recusa rótulo estranho ou trecho que deixou de valer. */
  private async fragments(job: string, labels: string[]): Promise<Fragment[]> {
    const served = await this.retrievedLabels(job);
    const fragments: Fragment[] = [];
    for (const label of labels) {
      const id = served.get(label);
      if (!id) throw new OpenWorkError(409, "label_not_served", "Trecho não entregue a este trabalho");
      const passage = await this.knowledge.passageForAgents(id);
      if (!passage) throw new OpenWorkError(409, "fragment_no_longer_valid", "Uma fonte usada deixou de valer; recomece a análise");
      fragments.push({ label, source: passage.source, title: passage.title, version: passage.version, validFrom: passage.validFrom, text: passage.text });
    }
    return fragments;
  }

  private async withinBudget(job: string, slot: string) {
    if (slot === "plan") return true;
    const { plan } = await this.job(job);
    const limit = Number(plan?.max_model_calls ?? 0);
    return (await this.ledger.listInferences(job)).length <= limit;
  }

  private async job(id: string) {
    const job = await this.ledger.getJob(id);
    if (!job) throw new OpenWorkError(404, "job_not_found", "Trabalho não encontrado");
    return { goal: job.goal, plan: job.plan ? JSON.parse(job.plan) : null };
  }
}
