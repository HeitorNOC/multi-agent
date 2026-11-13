import React, { useRef, useState } from "react";
import type { AgentActivity } from "./agent-activity.ts";
import "./brain-map.css";

interface MapAgent {
  id: string;
  title: string;
  kind: "director" | "specialist";
  children: string[];
}

interface MapDocument {
  source: string;
  version: number;
  title: string;
  area: string;
  current: boolean;
}

interface BrainMapProps {
  catalog: MapAgent[];
  documents: MapDocument[];
  source: string;
  selected: string[];
  inspect: string;
  sourceCount: number;
  activity: Map<string, AgentActivity>;
  onInspect: (id: string) => void;
  onSelectAgent: (id: string) => void;
  onOpenSource: (source: string) => void;
}

interface Point {
  x: number;
  y: number;
  z: number;
}

const center = { x: 480, y: 310 };
const initialCamera = { yaw: -0.27, pitch: 0.24, zoom: 1 };
const origin = { x: 0, y: 0, z: 0 };
const orbits = [155, 250];
const documentKey = (doc: MapDocument) => `${doc.source}:${doc.version}`;
const areaLabels: Record<string, string> = {
  executive: "Executivo",
  sales: "Vendas",
  marketing: "Marketing",
  finance: "Finanças",
  operations: "Operações",
  legal: "Jurídico",
  people: "Pessoas",
  technology: "Tecnologia",
};

function orbit(radius: number, angle: number, z = 0): Point {
  return { x: radius * Math.cos(angle), y: radius * Math.sin(angle), z };
}

function project(point: Point, { yaw, pitch, zoom }: typeof initialCamera) {
  const x = point.x * Math.cos(yaw) + point.z * Math.sin(yaw);
  const depth = point.z * Math.cos(yaw) - point.x * Math.sin(yaw);
  const y = point.y * Math.cos(pitch) - depth * Math.sin(pitch);
  const z = point.y * Math.sin(pitch) + depth * Math.cos(pitch);
  const scale = (950 / (950 - z)) * zoom;
  return { x: center.x + x * scale, y: center.y + y * scale, z, scale };
}

export function BrainMap({
  catalog,
  documents,
  source,
  selected,
  inspect,
  sourceCount,
  activity,
  onInspect,
  onSelectAgent,
  onOpenSource,
}: BrainMapProps) {
  const [camera, setCamera] = useState(initialCamera);
  const [mode, setMode] = useState<"agents" | "knowledge">("agents");
  const [area, setArea] = useState("");
  const drag = useRef<{
    pointer: number;
    x: number;
    y: number;
    moved: boolean;
  } | null>(null);
  const knowledge = mode === "knowledge";
  const grouped = new Map<string, MapDocument[]>();
  for (const document of documents) {
    const group = grouped.get(document.area);
    if (group) group.push(document);
    else grouped.set(document.area, [document]);
  }
  const mapDocuments = new Map(documents.map((doc) => [documentKey(doc), doc]));
  const knowledgeNodes: MapAgent[] = [];
  for (const [name, group] of grouped) {
    knowledgeNodes.push({
      id: `area:${name}`,
      title: `${areaLabels[name] ?? name} · ${group.length}`,
      kind: "director",
      children: group.map(documentKey),
    });
    knowledgeNodes.push(
      ...group.map(
        (doc): MapAgent => ({
          id: documentKey(doc),
          title: doc.title,
          kind: "specialist",
          children: [],
        }),
      ),
    );
  }
  const items = knowledge ? knowledgeNodes : catalog;
  const directors = items.filter((agent) => agent.kind === "director");
  const positions = new Map<string, Point>([["brain", origin]]);
  const edges: { from: string; to: string }[] = [];
  for (const [index, director] of directors.entries()) {
    const angle = -Math.PI / 2 + (index * 2 * Math.PI) / directors.length;
    positions.set(director.id, orbit(orbits[0], angle));
    edges.push({ from: "brain", to: director.id });
    for (const [childIndex, child] of director.children.entries()) {
      const spacing = Math.min(
        0.33,
        ((Math.PI / directors.length) * 1.45) / director.children.length,
      );
      const offset =
        (childIndex - (director.children.length - 1) / 2) * spacing;
      positions.set(
        child,
        orbit(orbits[1], angle + offset, childIndex % 2 ? 38 : -38),
      );
      edges.push({ from: director.id, to: child });
    }
  }
  const nodes = [
    {
      id: "brain",
      title: knowledge ? "Cérebro · Acervo" : "Cérebro · Chief of Staff",
      kind: "hub",
    },
    ...items,
  ].flatMap((agent) => {
    const point = positions.get(agent.id);
    return point ? [{ ...agent, ...project(point, camera) }] : [];
  });
  nodes.sort((a, b) => a.z - b.z);
  const projected = new Map(nodes.map((node) => [node.id, node]));
  const running = (id: string) => activity.get(id)?.status === "running";
  const runningCount = selected.filter(running).length;
  const focused = knowledge ? source || area || "brain" : inspect;

  function selectNode(id: string) {
    if (!knowledge) {
      onInspect(id);
    } else if (mapDocuments.has(id)) {
      onOpenSource(id);
    } else {
      onOpenSource("");
      setArea(id === "brain" || area === id ? "" : id);
    }
  }

  function moveCamera(yaw: number, pitch: number) {
    setCamera((view) => ({
      ...view,
      yaw: view.yaw + yaw,
      pitch: Math.max(-1.05, Math.min(1.05, view.pitch + pitch)),
    }));
  }

  function zoomBy(step: number) {
    setCamera((view) => ({
      ...view,
      zoom: Math.max(0.65, Math.min(1.65, view.zoom + step)),
    }));
  }

  return (
    <section className="panel brain-panel spatial-panel">
      <div className="panel-title">
        <div>
          <div className="eyebrow">CENTRO DE COMANDO</div>
          <h2>
            {knowledge ? "Cérebro e acervo 3D" : "Cérebro e rede de agentes 3D"}
          </h2>
          <p>
            {knowledge
              ? "Arraste para girar. Selecione um documento para consultar o original."
              : "Arraste para girar. Selecione um nó para inspecionar sua participação."}
          </p>
        </div>
        <div className="legend spatial-legend">
          {knowledge ? (
            <>
              <span>
                <i className="done" /> Vigente
              </span>
              <span>
                <i className="historical" /> Histórico
              </span>
            </>
          ) : (
            <>
              <span>
                <i className="selected" /> Selecionado
              </span>
              <span>
                <i className="running" /> Em execução
              </span>
              <span>
                <i className="done" /> Concluído
              </span>
              <span>
                <i className="paused" /> Interrompido
              </span>
              <span>
                <i /> Disponível
              </span>
            </>
          )}
        </div>
      </div>
      <div className="spatial-modes" role="group" aria-label="Visão do cérebro">
        <button
          className="secondary"
          aria-pressed={!knowledge}
          onClick={() => setMode("agents")}
        >
          Agentes
        </button>
        <button
          className="secondary"
          aria-pressed={knowledge}
          onClick={() => setMode("knowledge")}
        >
          Conhecimento
        </button>
      </div>
      <div
        className="map-controls spatial-controls"
        aria-label="Controles do mapa"
      >
        <button
          className="secondary"
          onClick={() => moveCamera(-0.24, 0)}
          aria-label="Girar à esquerda"
        >
          ←
        </button>
        <button
          className="secondary"
          onClick={() => moveCamera(0.24, 0)}
          aria-label="Girar à direita"
        >
          →
        </button>
        <button
          className="secondary"
          onClick={() => zoomBy(-0.15)}
          aria-label="Reduzir mapa"
        >
          −
        </button>
        <button
          className="secondary"
          onClick={() => zoomBy(0.15)}
          aria-label="Ampliar mapa"
        >
          +
        </button>
        <button className="secondary" onClick={() => setCamera(initialCamera)}>
          Recentrar
        </button>
        {knowledge ? (
          <select
            aria-label="Inspecionar documento"
            value={source}
            onChange={(event) => onOpenSource(event.target.value)}
          >
            <option value="">Selecione um documento</option>
            {documents.map((doc) => (
              <option key={documentKey(doc)} value={documentKey(doc)}>
                {doc.title} · v{doc.version}
                {doc.current ? "" : " · histórico"}
              </option>
            ))}
          </select>
        ) : (
          <select
            aria-label="Inspecionar agente"
            value={inspect}
            onChange={(event) => onSelectAgent(event.target.value)}
          >
            <option value="brain">Cérebro e Chief of Staff</option>
            {catalog.map((agent) => (
              <option key={agent.id} value={agent.id}>
                {agent.title}
              </option>
            ))}
          </select>
        )}
      </div>
      <svg
        viewBox="0 0 960 620"
        className="spatial-map"
        aria-label={
          knowledge
            ? "Mapa tridimensional do acervo por área"
            : "Mapa tridimensional do cérebro, diretorias e especialistas"
        }
        role="group"
        onPointerDown={(event) => {
          if (!event.isPrimary || event.button !== 0) return;
          drag.current = {
            pointer: event.pointerId,
            x: event.clientX,
            y: event.clientY,
            moved: false,
          };
        }}
        onPointerMove={(event) => {
          const current = drag.current;
          if (!current || current.pointer !== event.pointerId || !event.buttons)
            return;
          const dx = event.clientX - current.x;
          const dy = event.clientY - current.y;
          if (!current.moved && Math.hypot(dx, dy) < 4) return;
          if (!current.moved)
            event.currentTarget.setPointerCapture(event.pointerId);
          drag.current = {
            ...current,
            x: event.clientX,
            y: event.clientY,
            moved: true,
          };
          moveCamera(dx * 0.007, dy * 0.007);
        }}
        onPointerCancel={() => {
          drag.current = null;
        }}
        onPointerLeave={(event) => {
          if (!event.currentTarget.hasPointerCapture(event.pointerId))
            drag.current = null;
        }}
      >
        <defs>
          <radialGradient id="spatial-core" cx="36%" cy="28%">
            <stop offset="0" stopColor="#b4faff" />
            <stop offset=".3" stopColor="#247cc1" />
            <stop offset=".76" stopColor="#10253e" />
            <stop offset="1" stopColor="#0d1729" />
          </radialGradient>
          <radialGradient id="spatial-halo">
            <stop offset="0" stopColor="#24a9f3" stopOpacity=".27" />
            <stop offset="1" stopColor="#24a9f3" stopOpacity="0" />
          </radialGradient>
        </defs>
        <circle cx={center.x} cy={center.y} r="285" fill="url(#spatial-halo)" />
        {orbits.map((radius) => (
          <polygon
            key={radius}
            className="spatial-orbit"
            points={Array.from({ length: 72 }, (_, step) => {
              const point = project(
                orbit(radius, (step * Math.PI) / 36),
                camera,
              );
              return `${point.x},${point.y}`;
            }).join(" ")}
          />
        ))}
        {edges.map(({ from, to }) => {
          const start = projected.get(from);
          const end = projected.get(to);
          if (!start || !end) return null;
          return (
            <line
              key={to}
              x1={start.x}
              y1={start.y}
              x2={end.x}
              y2={end.y}
              className={`spatial-edge ${knowledge ? (from === area || to === focused ? "selected" : "") : running(to) ? "running" : selected.includes(to) ? "selected" : ""}`}
            />
          );
        })}
        {nodes.map((node) => {
          const hub = node.kind === "hub";
          const director = node.kind === "director";
          const document = knowledge ? mapDocuments.get(node.id) : undefined;
          const focusedNode = focused === node.id;
          const showLabel =
            knowledge || director || focusedNode || selected.includes(node.id);
          const radius = hub ? 59 : director ? 19 : showLabel ? 12 : 8;
          const state = document
            ? document.current
              ? "done"
              : "historical"
            : (activity.get(node.id)?.status ?? "available");
          const label =
            document && !focusedNode ? `v${document.version}` : node.title;
          const words = label.split(" ");
          const middle = Math.ceil(words.length / 2);
          return (
            <g
              key={node.id}
              transform={`translate(${node.x},${node.y}) scale(${node.scale})`}
              className={`spatial-node ${node.kind} ${state} ${focusedNode ? "focused" : ""}`}
              role="button"
              tabIndex={0}
              aria-label={
                document
                  ? `${node.title} · versão ${document.version} · ${document.current ? "vigente" : "histórico"}`
                  : node.title
              }
              aria-pressed={focusedNode}
              onClick={(event) => {
                if (event.detail === 0 || !drag.current?.moved)
                  selectNode(node.id);
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  selectNode(node.id);
                }
              }}
            >
              {(document || !showLabel) && <title>{node.title}</title>}
              {hub && (
                <>
                  <circle r={radius + 9} className="core-ring" />
                  <circle r={radius + 19} className="core-ring outer" />
                </>
              )}
              <circle r={radius} className="spatial-dot" />
              {hub ? (
                <>
                  <ellipse rx="43" ry="20" className="core-grid" />
                  <ellipse rx="19" ry="44" className="core-grid" />
                  <path
                    d="M-44 0H44 M0-44V44 M-34-27L34 27 M-34 27L34-27"
                    className="core-grid"
                  />
                  <text y="4" className="core-title">
                    CÉREBRO
                  </text>
                  <text y="16" className="core-subtitle">
                    {knowledge ? "ACERVO VERSIONADO" : "CHIEF OF STAFF"}
                  </text>
                </>
              ) : (
                <>
                  <text y="4" className="spatial-symbol">
                    {state === "done" ? "✓" : director ? "◇" : "·"}
                  </text>
                  {showLabel && (
                    <text y={radius + 13} className="spatial-label">
                      <tspan x="0">{words.slice(0, middle).join(" ")}</tspan>
                      <tspan x="0" dy="12">
                        {words.slice(middle).join(" ")}
                      </tspan>
                    </text>
                  )}
                </>
              )}
            </g>
          );
        })}
      </svg>
      {knowledge ? (
        <div className="brain-footer">
          <b>
            {sourceCount} vigentes · {documents.length - sourceCount} históricos
          </b>
          <span>
            {grouped.size} áreas · conexões por classificação documental
          </span>
        </div>
      ) : (
        <div className="brain-footer">
          <b>
            {selected.length} selecionados · {runningCount} em execução
          </b>
          <span>
            {catalog.length - selected.length} disponíveis sem execução ·{" "}
            {sourceCount} fontes vigentes
          </span>
        </div>
      )}
    </section>
  );
}
