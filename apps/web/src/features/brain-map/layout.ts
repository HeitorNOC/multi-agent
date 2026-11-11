/**
 * Posições do mapa 3D, calculadas de forma determinística (o mesmo Cérebro desenha sempre igual):
 * o núcleo no centro, as áreas numa esfera achatada ao redor e, em volta de cada área, os itens
 * dela (documentos no modo Conhecimento, agentes no modo Agentes), virados para fora.
 *
 * Só matemática: nada de three.js aqui, para testar e reaproveitar.
 */
export type Vec3 = [number, number, number];

export type NodeKind = "core" | "area" | "source" | "agent";
/** Estado que muda a cor do nó. */
export type NodeState = "current" | "history" | "idle" | "running" | "waiting" | "done";

export interface MapNode {
  id: string;
  kind: NodeKind;
  label: string;
  sublabel?: string;
  position: Vec3;
  state: NodeState;
  /** Tamanho relativo (área com mais itens fica maior). */
  size: number;
  /** Para abrir o detalhe ao clicar. */
  ref?: string;
}

export interface MapEdge {
  from: string;
  to: string;
  /** Destaque (por exemplo, quem responde a quem, ou um agente trabalhando). */
  strong?: boolean;
}

export interface MapArea {
  id: string;
  title: string;
}

export interface MapSource {
  id: string;
  title: string;
  area: string;
  status: "current" | "superseded" | "not_yet_valid" | "revoked";
  version: number;
  format?: string;
}

export interface MapAgent {
  id: string;
  name: string;
  title: string;
  area: string;
  reportsTo: string | null;
  /** O que o agente está fazendo agora (trabalhos em andamento). */
  activity: "idle" | "running" | "waiting" | "done";
}

const AREA_RADIUS = 8;
const FLATTEN = 0.55;
const ITEM_DISTANCE = 3;

/**
 * Áreas num anel horizontal (como na v1), com um leve sobe e desce para dar profundidade. Vista de
 * cima em ângulo, nenhuma área fica escondida atrás do núcleo.
 */
export function ring(n: number, radius: number): Vec3[] {
  return Array.from({ length: n }, (_, i) => {
    const a = (i / n) * Math.PI * 2 + Math.PI / 2;
    return [Math.cos(a) * radius, (i % 2 ? 0.9 : -0.9) * Math.min(1, n / 4), Math.sin(a) * radius];
  });
}

/** Pontos bem espalhados numa esfera (espiral de Fibonacci). */
export function fibonacci(n: number, radius: number): Vec3[] {
  if (n === 1) return [[radius, 0, 0]];
  const golden = Math.PI * (3 - Math.sqrt(5));
  return Array.from({ length: n }, (_, i) => {
    const y = 1 - (i / Math.max(1, n - 1)) * 2;
    const r = Math.sqrt(1 - y * y);
    const theta = golden * i;
    return [Math.cos(theta) * r * radius, y * radius * FLATTEN, Math.sin(theta) * r * radius];
  });
}

const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const scale = (a: Vec3, k: number): Vec3 => [a[0] * k, a[1] * k, a[2] * k];
const norm = (a: Vec3): Vec3 => {
  const l = Math.hypot(...a) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

/** `count` posições num anel ao redor de `center`, afastado para fora do núcleo. */
export function around(center: Vec3, count: number): Vec3[] {
  const out = norm(center);
  const helper: Vec3 = Math.abs(out[1]) > 0.9 ? [1, 0, 0] : [0, 1, 0];
  const u = norm(cross(out, helper));
  const v = norm(cross(out, u));
  const ring = Math.min(1.6 + count * 0.22, 3.6);
  const base = add(center, scale(out, ITEM_DISTANCE));
  if (count === 1) return [base];
  return Array.from({ length: count }, (_, i) => {
    const a = (i / count) * Math.PI * 2;
    // Itens alternam um pouco para dentro e para fora, para os rótulos não se sobreporem.
    const depth = i % 2 ? 0.5 : 0;
    return add(add(base, scale(out, depth)), add(scale(u, Math.cos(a) * ring), scale(v, Math.sin(a) * ring)));
  });
}

const SOURCE_STATE: Record<MapSource["status"], NodeState> = { current: "current", superseded: "history", not_yet_valid: "history", revoked: "history" };

/** Conhecimento: núcleo → áreas com fontes → fontes (revogadas ficam fora). */
export function knowledgeMap(areas: MapArea[], sources: MapSource[]): { nodes: MapNode[]; edges: MapEdge[] } {
  const visible = sources.filter((s) => s.status !== "revoked");
  const used = areas.filter((a) => visible.some((s) => s.area === a.id));
  const nodes: MapNode[] = [{ id: "core", kind: "core", label: "Cérebro", sublabel: "acervo versionado", position: [0, 0, 0], state: "current", size: 1 }];
  const edges: MapEdge[] = [];
  ring(used.length, AREA_RADIUS).forEach((position, i) => {
    const area = used[i]!;
    const mine = visible.filter((s) => s.area === area.id);
    nodes.push({ id: `area:${area.id}`, kind: "area", label: area.title, sublabel: `${mine.length}`, position, state: "current", size: 0.8 + Math.min(mine.length, 12) * 0.04 });
    edges.push({ from: "core", to: `area:${area.id}` });
    around(position, mine.length).forEach((p, j) => {
      const s = mine[j]!;
      nodes.push({
        id: `source:${s.id}`,
        kind: "source",
        label: s.title,
        sublabel: `${s.format ?? ""} v${s.version}`.trim(),
        position: p,
        state: SOURCE_STATE[s.status],
        size: 0.5,
        ref: s.id,
      });
      edges.push({ from: `area:${area.id}`, to: `source:${s.id}` });
    });
  });
  return { nodes, edges };
}

const AGENT_STATE: Record<MapAgent["activity"], NodeState> = { idle: "idle", running: "running", waiting: "waiting", done: "done" };

/**
 * Agentes: núcleo (Chief of Staff) → áreas do time → agentes. Quem responde a outro agente fica
 * ligado a ele (linha forte), além da área.
 */
export function agentsMap(areas: MapArea[], agents: MapAgent[]): { nodes: MapNode[]; edges: MapEdge[] } {
  const used = areas.filter((a) => agents.some((g) => g.area === a.id));
  const nodes: MapNode[] = [{ id: "core", kind: "core", label: "Cérebro", sublabel: "Chief of Staff", position: [0, 0, 0], state: "current", size: 1 }];
  const edges: MapEdge[] = [];
  const ids = new Set(agents.map((a) => a.id));
  ring(used.length, AREA_RADIUS).forEach((position, i) => {
    const area = used[i]!;
    const mine = agents.filter((g) => g.area === area.id);
    const running = mine.some((g) => g.activity === "running");
    const waiting = mine.some((g) => g.activity === "waiting");
    const busy = running || waiting;
    const state: NodeState = running ? "running" : waiting ? "waiting" : "current";
    nodes.push({ id: `area:${area.id}`, kind: "area", label: area.title, sublabel: `${mine.length}`, position, state, size: 0.8 + mine.length * 0.05 });
    edges.push({ from: "core", to: `area:${area.id}`, strong: busy });
    around(position, mine.length).forEach((p, j) => {
      const g = mine[j]!;
      nodes.push({ id: `agent:${g.id}`, kind: "agent", label: g.name, sublabel: g.title, position: p, state: AGENT_STATE[g.activity], size: 0.55, ref: g.id });
      edges.push({ from: `area:${area.id}`, to: `agent:${g.id}`, strong: g.activity === "running" || g.activity === "waiting" });
    });
  });
  for (const g of agents) if (g.reportsTo && ids.has(g.reportsTo)) edges.push({ from: `agent:${g.reportsTo}`, to: `agent:${g.id}`, strong: true });
  return { nodes, edges };
}
