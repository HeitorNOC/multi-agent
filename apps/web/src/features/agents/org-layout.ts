/**
 * Posições do organograma em cartões: cada nível numa coluna (horizontal) ou linha (vertical), e
 * cada chefe centrado entre os seus subordinados. As ligações são cotovelos que saem do meio do
 * cartão de cima e chegam ao meio do de baixo (a seta fica na ponta, no SVG).
 */
export type Orientation = "horizontal" | "vertical";

export interface TreeNode {
  id: string;
  children: TreeNode[];
}

export interface Placed {
  id: string;
  x: number;
  y: number;
  depth: number;
}

export interface OrgLayout {
  nodes: Placed[];
  edges: { from: string; to: string; d: string }[];
  width: number;
  height: number;
}

export const CARD = { w: 216, h: 78 };
const GAP = { horizontal: { main: 72, cross: 16 }, vertical: { main: 60, cross: 20 } };

export function layoutTree(root: TreeNode, orientation: Orientation): OrgLayout {
  const gap = GAP[orientation];
  const nodes: Placed[] = [];
  const edges: OrgLayout["edges"] = [];
  let slot = 0;
  // Posição no eixo transversal em "vagas": folhas em sequência, chefes no meio dos filhos.
  const cross = new Map<string, number>();
  const place = (n: TreeNode, depth: number): number => {
    let c: number;
    if (!n.children.length) c = slot++;
    else {
      const kids = n.children.map((k) => place(k, depth + 1));
      c = (kids[0]! + kids.at(-1)!) / 2;
    }
    cross.set(n.id, c);
    nodes.push({ id: n.id, x: 0, y: 0, depth });
    return c;
  };
  place(root, 0);
  const crossStep = (orientation === "horizontal" ? CARD.h : CARD.w) + gap.cross;
  const mainStep = (orientation === "horizontal" ? CARD.w : CARD.h) + gap.main;
  for (const p of nodes) {
    const c = cross.get(p.id)! * crossStep;
    const m = p.depth * mainStep;
    if (orientation === "horizontal") Object.assign(p, { x: m, y: c });
    else Object.assign(p, { x: c, y: m });
  }
  const at = new Map(nodes.map((p) => [p.id, p]));
  const walk = (n: TreeNode) => {
    const a = at.get(n.id)!;
    for (const k of n.children) {
      const b = at.get(k.id)!;
      if (orientation === "horizontal") {
        const x1 = a.x + CARD.w;
        const y1 = a.y + CARD.h / 2;
        const xm = x1 + gap.main / 2;
        edges.push({ from: n.id, to: k.id, d: `M${x1} ${y1}H${xm}V${b.y + CARD.h / 2}H${b.x - 2}` });
      } else {
        const x1 = a.x + CARD.w / 2;
        const y1 = a.y + CARD.h;
        const ym = y1 + gap.main / 2;
        edges.push({ from: n.id, to: k.id, d: `M${x1} ${y1}V${ym}H${b.x + CARD.w / 2}V${b.y - 2}` });
      }
      walk(k);
    }
  };
  walk(root);
  const width = Math.max(...nodes.map((p) => p.x)) + CARD.w;
  const height = Math.max(...nodes.map((p) => p.y)) + CARD.h;
  // Ordem estável para a leitura (de cima para baixo, como na árvore).
  nodes.sort((p, q) => p.depth - q.depth || p.x + p.y - (q.x + q.y));
  return { nodes, edges, width, height };
}
