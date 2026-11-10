import React, { useState } from "react";
import "./operations-overview.css";

interface OverviewJob {
  id: string;
  goal: string;
  status: string;
  worker_active: boolean;
  events: {
    seq: number;
    at: string;
    node: string;
    detail: { capability?: string };
  }[];
}

const stages: Record<string, string> = {
  worker_started: "Worker iniciado",
  checkpoint_loaded: "Checkpoint consultado",
  chief_of_staff: "Compondo a equipe",
  plan: "Equipe designada",
  specialist_started: "Especialista iniciou a análise",
  director_started: "Diretoria iniciou a revisão",
  retrieval_completed: "Evidências consultadas",
  canonical_evidence_verified: "Originais conferidos",
  inference_requested: "Inferência solicitada",
  inference_completed: "Resultado de inferência registrado",
  specialist_completed: "Achados entregues à diretoria",
  director_completed: "Parecer da diretoria entregue",
  synthesis: "Síntese integrada iniciada",
  review_ready: "Parecer preparado para revisão",
  effect_receipt: "Recibo local registrado",
};

const attention: Record<string, { label: string; action: string }> = {
  awaiting_approval: { label: "Revisão humana", action: "Abrir parecer" },
  recovery_required: {
    label: "Conciliação de inferência",
    action: "Abrir recuperação",
  },
  interrupted: { label: "Trabalho interrompido", action: "Ver retomada" },
  failed: { label: "Falha registrada", action: "Ver trabalho" },
};

const clock = new Intl.DateTimeFormat("pt-BR", {
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
});

function latestStage(job: OverviewJob) {
  const start = job.events.findLast((event) => event.node === "worker_started");
  if (!start) return undefined;
  return job.events.findLast(
    (event) =>
      Object.hasOwn(stages, event.node) &&
      event.seq >= start.seq &&
      Date.parse(event.at) >= Date.parse(start.at),
  );
}

export function OperationsOverview({
  jobs,
  queue,
  operator,
  title,
  agentName,
  onOpen,
}: {
  jobs: OverviewJob[];
  queue?: { pending: number };
  operator: boolean;
  title: (job: OverviewJob) => string;
  agentName: (id: string) => string | undefined;
  onOpen: (id: string, destination: "job" | "recovery") => void;
}) {
  const running = jobs.filter((job) => job.worker_active);
  const pending = jobs.filter(
    (job) => !job.worker_active && Object.hasOwn(attention, job.status),
  );
  const queued =
    queue?.pending ?? jobs.filter((job) => job.status === "queued").length;
  const [light, setLight] = useState(false);

  return (
    <section
      className="panel operations-overview"
      data-theme={light ? "light" : "dark"}
      aria-label="Visão operacional da sessão"
    >
      <div className="operations-heading">
        <div>
          <h2>Visão operacional</h2>
          <p>
            Acompanhe o trabalho dos agentes e as decisões que esperam por uma
            pessoa.
          </p>
        </div>
        <div className="operations-controls">
          <span className="operations-queue">
            <strong>{queued}</strong> na fila
          </span>
          <button
            type="button"
            className="operations-theme"
            aria-pressed={light}
            onClick={() => setLight(!light)}
          >
            Tema claro
          </button>
        </div>
      </div>
      <div className="operations-columns">
        <div>
          <h3>
            Em andamento <span>{running.length}</span>
          </h3>
          {running.length === 0 ? (
            <p className="operations-empty">Nenhum worker em atividade.</p>
          ) : (
            <ul className="operations-list">
              {running.map((job) => {
                const event = latestStage(job);
                const capability = event?.detail.capability;
                const name = capability ? agentName(capability) : undefined;
                const timestamp = event ? Date.parse(event.at) : NaN;
                return (
                  <li key={job.id} className="operations-running">
                    <div>
                      <strong>{title(job)}</strong>
                      <span>
                        {name && `${name} · `}
                        {event
                          ? stages[event.node]
                          : "Aguardando o primeiro evento do worker"}
                      </span>
                      {Number.isFinite(timestamp) && (
                        <time dateTime={event?.at}>
                          Último evento às {clock.format(timestamp)}
                        </time>
                      )}
                    </div>
                    <button
                      className="secondary"
                      onClick={() => onOpen(job.id, "job")}
                    >
                      Ver execução
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
        <div>
          <h3>
            Pendências da sessão <span>{pending.length}</span>
          </h3>
          {pending.length === 0 ? (
            <p className="operations-empty">Nenhuma intervenção pendente.</p>
          ) : (
            <ul className="operations-list">
              {pending.map((job) => {
                const item = attention[job.status];
                const recovery = operator && job.status === "recovery_required";
                return (
                  <li key={job.id} className="operations-pending">
                    <div>
                      <strong>{title(job)}</strong>
                      <span
                        className="operations-attention"
                        data-status={job.status}
                      >
                        {item.label}
                      </span>
                    </div>
                    <button
                      className="secondary"
                      onClick={() =>
                        onOpen(job.id, recovery ? "recovery" : "job")
                      }
                    >
                      {operator || job.status === "awaiting_approval"
                        ? item.action
                        : "Ver trabalho"}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </section>
  );
}
