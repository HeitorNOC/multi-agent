import React, { useLayoutEffect, useRef, useState } from "react";
import {
  agentStatusLabel,
  type AgentActivity,
  type CatalogAgent,
  type DelegatedTeam,
} from "./agent-activity.ts";
import { delegationLayout } from "./delegation-layout.ts";
import "./delegation-flow.css";

interface Props {
  catalog: CatalogAgent[];
  activity: Map<string, AgentActivity>;
  teams: DelegatedTeam[];
  children?: Map<string, string[]>;
  chiefAction: string;
  inspect: string;
  onInspect: (id: string) => void;
}

const roleNames = {
  chief: "Coordenação",
  director: "Diretoria",
  specialist: "Especialista",
  developer: "Desenvolvedor",
};
const roleSymbols = { chief: "✦", director: "◇", specialist: "○", developer: "○" };

export function DelegationFlow({
  catalog,
  activity,
  teams,
  children,
  chiefAction,
  inspect,
  onInspect,
}: Props) {
  const [horizontal, setHorizontal] = useState(() => window.innerWidth > 700);
  const viewport = useRef<HTMLDivElement>(null);
  const { size, card, nodes, routes } = delegationLayout(teams, horizontal, children);
  const names = new Map(catalog.map((agent) => [agent.id, agent.title]));
  const activeTeam = teams.find(
    (team) => team.lead === inspect || team.specialists.some(
      (id) => id === inspect || children?.get(id)?.includes(inspect),
    ),
  );

  useLayoutEffect(() => {
    const container = viewport.current;
    if (container) {
      container.scrollLeft = horizontal
        ? 0
        : (container.scrollWidth - container.clientWidth) / 2;
    }
  }, [horizontal, size.width]);

  return (
    <section className="panel delegation-panel" aria-label="Fluxo de delegação">
      <div className="flow-heading">
        <div>
          <h2>Fluxo de delegação</h2>
          <p>Da decisão do Chief às equipes designadas.</p>
        </div>
        <div
          className="agent-view-controls flow-direction"
          role="group"
          aria-label="Direção do fluxo"
        >
          <button
            className="secondary"
            aria-pressed={horizontal}
            onClick={() => setHorizontal(true)}
          >
            <span aria-hidden="true">↦</span> Horizontal
          </button>
          <button
            className="secondary"
            aria-pressed={!horizontal}
            onClick={() => setHorizontal(false)}
          >
            <span aria-hidden="true">↧</span> Vertical
          </button>
        </div>
      </div>
      <div
        className="flow-viewport"
        ref={viewport}
        role="region"
        tabIndex={0}
        aria-label="Diagrama de delegação"
      >
        <div
          className={`delegation-tree ${horizontal ? "horizontal" : "vertical"}`}
          style={size}
        >
          <svg
            className="flow-wiring"
            width={size.width}
            height={size.height}
            aria-hidden="true"
          >
            {routes.map(({ parent, trunk, arms, hub }) => {
              const focused =
                parent === inspect || arms.some(({ id }) => id === inspect);
              return (
                <g
                  key={parent}
                  className={focused ? "flow-route focused" : "flow-route"}
                >
                  <path d={trunk} />
                  <circle
                    className="flow-junction"
                    cx={hub.x}
                    cy={hub.y}
                    r={3}
                  />
                  {arms.map(({ id, path, end }) => (
                    <g
                      key={id}
                      data-status={activity.get(id)?.status}
                      className={id === inspect ? "focus-arm" : undefined}
                    >
                      <path d={path} />
                      <circle
                        className="flow-port"
                        cx={end.x}
                        cy={end.y}
                        r={3}
                      />
                    </g>
                  ))}
                </g>
              );
            })}
          </svg>
          {nodes.map(({ id, role, center }) => {
            const chief = role === "chief";
            const current = activity.get(id);
            return (
              <button
                key={id}
                className={`delegation-node ${role}`}
                data-agent={id}
                data-status={current?.status}
                style={{ ...card, left: center.x, top: center.y }}
                aria-pressed={inspect === id}
                title={chief ? chiefAction : current?.action}
                onClick={() => onInspect(id)}
              >
                <span className="flow-role">
                  <span aria-hidden="true">{roleSymbols[role]}</span>
                  {roleNames[role]}
                </span>
                <b>{chief ? "Chief of Staff" : (names.get(id) ?? id)}</b>
                <small className="flow-node-state">
                  {chief
                    ? chiefAction
                    : current
                      ? agentStatusLabel[current.status]
                      : null}
                </small>
              </button>
            );
          })}
        </div>
      </div>
      <div className="flow-footer">
        <p>
          {teams.length
            ? `${teams.length} ${teams.length === 1 ? "diretoria designada" : "diretorias designadas"} · ${nodes.length - teams.length - 1} especialistas`
            : "As ramificações aparecem quando o Chief registra o plano."}
        </p>
        {activeTeam && (
          <p>
            <b>{names.get(activeTeam.lead) ?? activeTeam.lead}</b> ·{" "}
            {activeTeam.reason}
          </p>
        )}
      </div>
    </section>
  );
}
