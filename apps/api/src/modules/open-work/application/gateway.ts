/**
 * Gateway do trabalho aberto: o único caminho do worker até o Cérebro e o modelo.
 *
 * O worker (LangGraph) decide a ordem dos passos; o gateway decide o que cada passo pode ler e
 * aceitar. Ele nunca confia em texto vindo do worker: o pedido, o catálogo, os trechos e as
 * saídas anteriores são relidos do banco e do Cérebro; o worker só envia o passo e rótulos.
 *
 * Cada chamada ao modelo tem um recibo:
 *  - reservado antes de chamar; completado depois;
 *  - repetir o mesmo passo devolve o recibo, sem chamar de novo (retomada barata, sem duplicar);
 *  - falha sabida (CLI com erro, saída recusada) libera a reserva para nova tentativa;
 *  - reserva sem recibo encontrada depois de uma queda = resultado desconhecido: não chama de
 *    novo; o trabalho vai para `recovery_required`.
 */
import { createHash } from "node:crypto";
import type { Clock } from "../../../shared/clock.ts";
import { AppError, conflict, ensure, invalid, rateLimited, unavailable } from "../../../shared/errors.ts";
import type { JobId } from "../../../shared/ids.ts";
import { hashOf, type Json } from "../../../shared/json.ts";
import { stream } from "../../../platform/events/event-log.ts";
import type { CallLimiter } from "../../../platform/model/call-limiter.ts";
import { ModelCallError, type ModelClient } from "../../../platform/model/model-client.ts";
import type { JobsDeps } from "../../jobs/application/deps.ts";
import { loadJob } from "../../jobs/application/load-job.ts";
import { retrievedFragments } from "../../jobs/application/worker-reports.ts";
import * as transitions from "../../jobs/domain/transitions.ts";
import type { KnowledgeSearch } from "../../knowledge/application/knowledge-search.ts";
import type { CatalogAgent, TeamDirectory } from "../domain/catalog.ts";
import { planTask, specialistTask, synthesisTask, TaskOutputError, type Fragment, type SpecialistOutput, type TaskSpec } from "../domain/tasks.ts";

export interface OpenWorkDeps {
  jobs: JobsDeps;
  search: KnowledgeSearch;
  /** `null` quando a instalação não configurou modelo. */
  client: ModelClient | null;
  limiter: CallLimiter;
  /** O time da empresa: só esses agentes podem ser escalados. */
  team: TeamDirectory;
  clock: Clock;
  timeoutMs?: number;
}

const SLOT = /^(plan|synthesis|specialist:[a-z0-9_]{1,80})$/;
const LABEL = /^f-[0-9a-f]{8}$/;
const FRAGMENTS_PER_AGENT = 6;
const SPECIALIST = "specialist:";

/** Rótulo curto e estável de um trecho, fácil para o modelo copiar sem erro. */
export const labelOf = (passageId: string) => `f-${createHash("sha256").update(passageId).digest("hex").slice(0, 8)}`;

interface OpenPlan {
  agents: string[];
  max_model_calls: number;
}

export class OpenWorkGateway {
  private readonly deps: OpenWorkDeps;

  constructor(deps: OpenWorkDeps) {
    this.deps = deps;
  }

  /** Um agente do plano que ainda está no time; quem saiu do time não trabalha mais. */
  private async member(agentId: string): Promise<CatalogAgent> {
    const agent = (await this.deps.team.members()).find((a) => a.id === agentId);
    ensure(agent, () => conflict("agent_not_in_team", "Este especialista não está mais no time"));
    return agent;
  }

  /** Trechos do Cérebro para um especialista do plano; o que foi entregue fica na trilha do trabalho. */
  async retrieve(jobId: JobId, agentId: string) {
    const { goal, plan } = await this.job(jobId);
    ensure(plan?.agents.includes(agentId), () => conflict("agent_not_in_plan", "Especialista fora do plano"));
    const agent = await this.member(agentId);
    const passages = await this.deps.search.forAgents(`${goal}\n${agent.focus}`, FRAGMENTS_PER_AGENT, [agentId], { preferArea: agent.domain });
    const fragments = passages.map((p) => ({ ...p, label: labelOf(p.id) }));
    await this.deps.jobs.uow.run((s) =>
      s.events.append(stream.job(jobId), {
        kind: "knowledge_retrieved",
        detail: { agent: agentId, fragments: fragments.map((f) => ({ label: f.label, id: f.id, source: f.sourceId, version: f.version })) },
      }),
    );
    return {
      fragments: fragments.map((f) => ({ label: f.label, source: f.sourceId, title: f.title, version: f.version, valid_from: f.validFrom, url: f.url })),
    };
  }

  /** Executa (ou repete pelo recibo) um passo de modelo do trabalho. */
  async run(jobId: JobId, slot: string, input: { labels?: readonly string[] } = {}): Promise<{ output: Json; replayed: boolean }> {
    ensure(SLOT.test(slot), () => invalid("invalid_slot", "Passo inválido"));
    const client = this.deps.client;
    ensure(client, () => unavailable("model_not_configured", "Modelo do trabalho aberto não configurado"));
    const job = await this.job(jobId);
    const spec = await this.spec(jobId, job, slot, input);
    // O plano não conta; os demais passos contam contra o limite do plano (incluindo o reservado agora).
    const limit = slot === "plan" ? Infinity : this.deps.jobs.policy.modelCallLimit(job.plan as unknown as Json);
    const inputSha = hashOf({ slot, prompt: spec.prompt, system: spec.system });
    const { uow } = this.deps.jobs;

    const reservation = await uow.run(async (s) => {
      const { created, receipt } = await s.inferences.reserve({ jobId, slot, inputSha });
      if (created && (await s.inferences.list(jobId)).length > limit) {
        await s.inferences.release({ jobId, slot });
        return "over_budget" as const;
      }
      return created ? ("reserved" as const) : receipt;
    });
    if (reservation === "over_budget") throw rateLimited("plan_call_limit", "Limite de chamadas ao modelo do plano atingido");
    if (reservation !== "reserved") {
      ensure(reservation.inputSha === inputSha, () => conflict("input_changed", "Este passo já foi executado com outra entrada"));
      if (reservation.state === "completed") return { output: reservation.output!, replayed: true };
      await this.markUnknown(jobId, slot);
      throw conflict("inference_unknown", "Resultado de uma chamada ao modelo é desconhecido");
    }

    let output: Json;
    let usage: Record<string, number>;
    try {
      const result = await this.deps.limiter.tryRun(() =>
        client.complete({ system: spec.system, prompt: spec.prompt, schema: spec.schema, timeoutMs: this.deps.timeoutMs ?? 180_000 }),
      );
      if (result.busy) throw new ModelCallError("model_busy");
      output = spec.validate(result.value.json) as Json;
      usage = result.value.usage;
    } catch (error) {
      // Falha sabida: a CLI terminou ou a saída foi recusada. Libera para nova tentativa.
      const code = error instanceof ModelCallError || error instanceof TaskOutputError ? error.code : "model_error";
      await uow.run(async (s) => {
        await s.inferences.release({ jobId, slot });
        await s.events.append(stream.job(jobId), { kind: "inference_failed", detail: { slot, code } });
      });
      throw new AppError("unavailable", code, `Chamada ao modelo falhou: ${code}`);
    }
    await uow.run(async (s) => {
      await s.inferences.complete({ jobId, slot, output, usage });
      await s.events.append(stream.job(jobId), { kind: "inference_completed", detail: { slot, usage, provider: client.provider } });
    });
    return { output, replayed: false };
  }

  private async markUnknown(jobId: JobId, slot: string) {
    await this.deps.jobs.uow.run(async (s) => {
      const job = await loadJob(s.jobs, jobId);
      if (job.status !== "recovery_required" && ["running", "queued", "interrupted", "failed"].includes(job.status))
        await s.jobs.save(transitions.requireRecovery(job, "Uma chamada ao modelo ficou sem recibo; revise antes de retomar."));
      await s.events.append(stream.job(jobId), { kind: "inference_unknown", detail: { slot } });
    });
  }

  /** Monta a tarefa a partir do banco; o worker só indica o passo e, no especialista, os rótulos. */
  private async spec(jobId: JobId, { goal, plan }: { goal: string; plan: OpenPlan | null }, slot: string, input: { labels?: readonly string[] }): Promise<TaskSpec<unknown>> {
    if (slot === "plan") {
      const members = await this.deps.team.members();
      ensure(members.length, () => conflict("team_empty", "Monte seu time em Agentes antes de pedir um trabalho"));
      return planTask(goal, members);
    }
    ensure(plan, () => conflict("plan_missing", "Plano ausente"));
    const now = this.deps.clock.now();
    if (slot === "synthesis") {
      const findings: { agent: string; claim: string; citations: string[] }[] = [];
      for (const r of await this.deps.jobs.uow.read.inferences.list(jobId)) {
        if (!r.slot.startsWith(SPECIALIST) || r.state !== "completed") continue;
        const agent = r.slot.slice(SPECIALIST.length);
        for (const f of (r.output as unknown as SpecialistOutput).findings) findings.push({ agent, ...f });
      }
      const labels = [...new Set(findings.flatMap((f) => f.citations))];
      return synthesisTask(goal, findings, await this.fragments(jobId, labels, plan.agents), now);
    }
    const agentId = slot.slice(SPECIALIST.length);
    ensure(plan.agents.includes(agentId), () => conflict("agent_not_in_plan", "Especialista fora do plano"));
    const labels = input.labels ?? [];
    ensure(labels.length <= FRAGMENTS_PER_AGENT && labels.every((l) => LABEL.test(l)), () => invalid("invalid_labels", "Rótulos inválidos"));
    return specialistTask(goal, await this.member(agentId), await this.fragments(jobId, labels, [agentId]), now);
  }

  /** Resolve rótulos entregues a este trabalho; recusa rótulo estranho ou trecho que deixou de valer. */
  private async fragments(jobId: JobId, labels: readonly string[], agentIds: readonly string[]): Promise<Fragment[]> {
    const served = await retrievedFragments(this.deps.jobs.uow.read.events, jobId);
    const fragments: Fragment[] = [];
    for (const label of labels) {
      const id = served.get(label);
      ensure(id, () => conflict("label_not_served", "Trecho não entregue a este trabalho"));
      const passage = await this.deps.search.passageForAgents(id, agentIds);
      ensure(passage, () => conflict("fragment_no_longer_valid", "Uma fonte usada deixou de valer ou não está acessível a este agente; recomece a análise"));
      fragments.push({ label, source: passage.sourceId, title: passage.title, version: passage.version, validFrom: passage.validFrom, text: passage.text });
    }
    return fragments;
  }

  private async job(id: JobId) {
    const job = await loadJob(this.deps.jobs.uow.read.jobs, id);
    return { goal: job.goal, plan: job.plan as unknown as OpenPlan | null };
  }
}
