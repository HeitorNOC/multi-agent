import React from "react";
import {
  agentStatusLabel,
  type AgentActivity,
  type CatalogAgent,
} from "./agent-activity.ts";
import "./agent-views.css";

interface Props {
  catalog: CatalogAgent[];
  activity: Map<string, AgentActivity>;
  chiefAction: string;
  inspect: string;
  onInspect: (id: string) => void;
}

const decimal = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 1 });
function formatDuration(ms: number) {
  const seconds = ms / 1000;
  if (seconds < 60) return `${decimal.format(seconds)} s`;
  return `${Math.floor(seconds / 60)} min ${Math.floor(seconds % 60)} s`;
}

function Status({ activity }: { activity: AgentActivity }) {
  return (
    <span className={`agent-state ${activity.status}`}>
      {agentStatusLabel[activity.status]}
    </span>
  );
}

export function AgentList({
  catalog,
  activity,
  chiefAction,
  inspect,
  onInspect,
}: Props) {
  const titles = new Map(catalog.map((agent) => [agent.id, agent.title]));
  return (
    <section
      className="panel agent-list"
      aria-label="Lista operacional de agentes"
    >
      <div className="panel-title">
        <div>
          <h2>Lista operacional de agentes</h2>
          <p>
            {catalog.length} agentes do catálogo · atividade do trabalho
            selecionado.
          </p>
        </div>
      </div>
      <div
        className="agent-table-wrap"
        tabIndex={0}
        role="region"
        aria-label="Tabela de agentes"
      >
        <table className="agent-table">
          <thead>
            <tr>
              <th scope="col">Agente</th>
              <th scope="col">Status</th>
              <th scope="col">Atividade registrada</th>
              <th scope="col">Marcos</th>
              <th scope="col">Tempo observado</th>
              <th scope="col">Tempo restante</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <th scope="row">
                <button
                  aria-pressed={inspect === "brain"}
                  onClick={() => onInspect("brain")}
                >
                  Chief of Staff
                </button>
                <small>Coordenação</small>
              </th>
              <td colSpan={2}>{chiefAction}</td>
              <td>—</td>
              <td>—</td>
              <td>—</td>
            </tr>
            {catalog.map((agent) => {
              const current = activity.get(agent.id);
              if (!current) return null;
              const estimate = current.estimate;
              return (
                <tr key={agent.id}>
                  <th scope="row">
                    <button
                      aria-pressed={inspect === agent.id}
                      onClick={() => onInspect(agent.id)}
                    >
                      {agent.title}
                    </button>
                    <small>
                      {agent.parent ? titles.get(agent.parent) : "Diretoria"}
                    </small>
                  </th>
                  <td>
                    <Status activity={current} />
                  </td>
                  <td>{current.action}</td>
                  <td>
                    {current.milestones === null ? (
                      "—"
                    ) : (
                      <div className="agent-progress">
                        <progress
                          max={3}
                          value={current.milestones}
                          aria-label={`Marcos de ${agent.title}`}
                        />
                        <small>{current.milestones}/3</small>
                      </div>
                    )}
                  </td>
                  <td>
                    {current.elapsedMs === null
                      ? "—"
                      : formatDuration(current.elapsedMs)}
                  </td>
                  <td>
                    {estimate ? (
                      <>
                        {estimate.remainingMs > 0
                          ? `≈ ${formatDuration(estimate.remainingMs)}`
                          : "Prazo típico excedido"}
                        <small>{estimate.samples} execuções anteriores</small>
                      </>
                    ) : current.status === "running" ? (
                      "Histórico insuficiente"
                    ) : (
                      "—"
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="muted">
        Marcos confirmados: contexto, inferência e entrega. O tempo restante usa
        a mediana de pelo menos três execuções anteriores do mesmo agente no
        mesmo cenário.
      </p>
    </section>
  );
}
