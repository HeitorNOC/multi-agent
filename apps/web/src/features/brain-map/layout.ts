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
  return relax({ nodes, edges });
}

const AGENT_STATE: Record<MapAgent["activity"], NodeState> = { idle: "idle", running: "running", waiting: "waiting", done: "done" };

/**
 * Agentes: núcleo (Chief of Staff) → áreas do time → agentes. Quem responde a outro agente fica
 * ligado a ele (linha forte), além da área.
 */
export function agentsMap(
  areas: MapArea[],
  agents: MapAgent[],
  core: { label: string; sublabel: string } = { label: "Chief of Staff", sublabel: "coordena o time" },
): { nodes: MapNode[]; edges: MapEdge[] } {
  const used = areas.filter((a) => agents.some((g) => g.area === a.id));
  const nodes: MapNode[] = [{ id: "core", kind: "core", label: core.label, sublabel: core.sublabel, position: [0, 0, 0], state: "current", size: 1 }];
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
  return relax({ nodes, edges });
}

/**
 * Acomodação orgânica (como um grafo de notas): parte das posições em anel e roda uma simulação
 * de forças com número fixo de passos, sem acaso. Nós se repelem, ligações puxam até um
 * comprimento natural e o conjunto fica achatado (um disco com profundidade, fácil de ler de
 * cima). O núcleo fica preso no centro. Com muitos nós, menos passos (o custo cresce com n²).
 */
export function relax<T extends { nodes: MapNode[]; edges: MapEdge[] }>(graph: T): T {
  const { nodes, edges } = graph;
  const n = nodes.length;
  if (n < 3) return graph;
  const index = new Map(nodes.map((node, i) => [node.id, i]));
  const p = nodes.map((node) => [...node.position] as Vec3);
  const mass = nodes.map((node) => (node.kind === "core" ? 8 : node.kind === "area" ? 3 : 1));
  const links = edges
    .map((e) => {
      const a = index.get(e.from);
      const b = index.get(e.to);
      if (a === undefined || b === undefined) return null;
      const ka = nodes[a]!.kind;
      const kb = nodes[b]!.kind;
      // Núcleo → área: longe; área → item: perto; item ↔ item (quem responde a quem): fraco.
      const length = ka === "core" || kb === "core" ? 7 : ka === "area" || kb === "area" ? 2.6 : 3;
      const strength = ka === "core" || kb === "core" ? 0.06 : ka === "area" || kb === "area" ? 0.1 : 0.02;
      return { a, b, length, strength };
    })
    .filter((l): l is NonNullable<typeof l> => l !== null);
  const steps = Math.round(Math.min(220, Math.max(40, 6_000_000 / (n * n))));
  for (let step = 0; step < steps; step++) {
    const heat = 1 - step / steps;
    const f = p.map(() => [0, 0, 0] as Vec3);
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const dx = p[i]![0] - p[j]![0];
        const dy = p[i]![1] - p[j]![1];
        const dz = p[i]![2] - p[j]![2];
        const d2 = dx * dx + dy * dy + dz * dz + 0.05;
        if (d2 > 144) continue;
        const k = (1.1 * mass[i]! * mass[j]!) / (d2 * Math.sqrt(d2));
        f[i]![0] += dx * k; f[i]![1] += dy * k; f[i]![2] += dz * k;
        f[j]![0] -= dx * k; f[j]![1] -= dy * k; f[j]![2] -= dz * k;
      }
    }
    for (const l of links) {
      const dx = p[l.b]![0] - p[l.a]![0];
      const dy = p[l.b]![1] - p[l.a]![1];
      const dz = p[l.b]![2] - p[l.a]![2];
      const d = Math.hypot(dx, dy, dz) || 0.001;
      const k = ((d - l.length) * l.strength) / d;
      f[l.a]![0] += dx * k * mass[l.b]!; f[l.a]![1] += dy * k * mass[l.b]!; f[l.a]![2] += dz * k * mass[l.b]!;
      f[l.b]![0] -= dx * k * mass[l.a]!; f[l.b]![1] -= dy * k * mass[l.a]!; f[l.b]![2] -= dz * k * mass[l.a]!;
    }
    for (let i = 0; i < n; i++) {
      if (nodes[i]!.kind === "core") continue;
      const fi = f[i]!;
      // Achata (o eixo vertical pesa menos) e puxa de leve para o centro.
      fi[1] = fi[1] * 0.5 - p[i]![1] * 0.04 * mass[i]!;
      fi[0] -= p[i]![0] * 0.004 * mass[i]!;
      fi[2] -= p[i]![2] * 0.004 * mass[i]!;
      const move = Math.min(0.6 * heat + 0.02, Math.hypot(...fi) / mass[i]!);
      const len = Math.hypot(...fi) || 1;
      p[i]![0] += (fi[0] / len) * move;
      p[i]![1] += (fi[1] / len) * move;
      p[i]![2] += (fi[2] / len) * move;
    }
  }
  const round = (v: number) => Math.round(v * 1000) / 1000;
  return { ...graph, nodes: nodes.map((node, i) => ({ ...node, position: p[i]!.map(round) as Vec3 })) };
}

/**
 * Linha curva entre dois pontos (bezier quadrática), como nas imagens de referência: o arco
 * vai para um lado escolhido pelo próprio par (sempre igual), com curvatura proporcional ao
 * comprimento.
 */
export function curve(a: Vec3, b: Vec3, seed: string, segments = 14): Vec3[] {
  const dir: Vec3 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const length = Math.hypot(...dir);
  if (length < 1e-6) return [a, b];
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) | 0;
  const side = h & 1 ? 1 : -1;
  const up: Vec3 = Math.abs(dir[1] / length) > 0.9 ? [1, 0, 0] : [0, 1, 0];
  const perp = norm(cross(dir, up));
  const bend = length * (0.12 + ((h >>> 1) % 7) * 0.012) * side;
  const c: Vec3 = [(a[0] + b[0]) / 2 + perp[0] * bend, (a[1] + b[1]) / 2 + perp[1] * bend, (a[2] + b[2]) / 2 + perp[2] * bend];
  return Array.from({ length: segments + 1 }, (_, i) => {
    const t = i / segments;
    const u = 1 - t;
    return [u * u * a[0] + 2 * u * t * c[0] + t * t * b[0], u * u * a[1] + 2 * u * t * c[1] + t * t * b[1], u * u * a[2] + 2 * u * t * c[2] + t * t * b[2]];
  });
}
