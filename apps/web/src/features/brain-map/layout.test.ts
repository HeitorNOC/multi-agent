// Posições do mapa 3D: determinísticas, espalhadas, sem fontes revogadas e com quem responde a quem.
import assert from "node:assert/strict";
import { test } from "node:test";
import { agentsMap, around, fibonacci, knowledgeMap } from "./layout.ts";

const dist = (a: number[], b: number[]) => Math.hypot(a[0]! - b[0]!, a[1]! - b[1]!, a[2]! - b[2]!);

test("áreas espalhadas: nenhuma colada na outra, todas longe do núcleo", () => {
  const points = fibonacci(11, 7);
  for (let i = 0; i < points.length; i++) {
    assert.ok(Math.hypot(...points[i]!) > 3, "longe do núcleo");
    for (let j = i + 1; j < points.length; j++) assert.ok(dist(points[i]!, points[j]!) > 2, `áreas ${i} e ${j} afastadas`);
  }
  const ring = around([7, 0, 0], 8);
  assert.ok(ring.every((p) => Math.hypot(...p) > 7), "itens ficam para fora da área");
});

test("conhecimento: núcleo → áreas com fontes → fontes; revogadas ficam fora; igual a cada vez", () => {
  const areas = [
    { id: "general", title: "Geral" },
    { id: "finance", title: "Finanças" },
    { id: "people", title: "Pessoas" },
  ];
  const sources = [
    { id: "a", title: "Política", area: "general", status: "current" as const, version: 1, format: "MD" },
    { id: "b", title: "Orçamento", area: "finance", status: "superseded" as const, version: 2 },
    { id: "c", title: "Antiga", area: "finance", status: "revoked" as const, version: 1 },
  ];
  const map = knowledgeMap(areas, sources);
  assert.deepEqual(map.nodes.map((n) => n.id), ["core", "area:general", "source:a", "area:finance", "source:b"], "área sem fonte não aparece");
  assert.equal(map.nodes.find((n) => n.id === "source:b")!.state, "history");
  assert.equal(map.nodes.find((n) => n.id === "source:a")!.sublabel, "MD v1");
  assert.deepEqual(knowledgeMap(areas, sources), map, "determinístico");
});

test("agentes: trabalhando acende a área; quem responde a outro agente fica ligado a ele", () => {
  const map = agentsMap(
    [{ id: "operations", title: "Operações" }, { id: "finance", title: "Finanças" }],
    [
      { id: "bruno", name: "Bruno", title: "Compras", area: "operations", reportsTo: null, activity: "running" },
      { id: "fernanda", name: "Fernanda", title: "Financeiro", area: "finance", reportsTo: null, activity: "idle" },
      { id: "patricia", name: "Patrícia", title: "Controladoria", area: "finance", reportsTo: "fernanda", activity: "done" },
    ],
  );
  assert.equal(map.nodes.find((n) => n.id === "area:operations")!.state, "running");
  assert.equal(map.nodes.find((n) => n.id === "area:finance")!.state, "current");
  assert.ok(map.edges.some((e) => e.from === "agent:fernanda" && e.to === "agent:patricia" && e.strong));
});
