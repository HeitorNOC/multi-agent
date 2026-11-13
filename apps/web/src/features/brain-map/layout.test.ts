// Posições do mapa 3D: determinísticas, espalhadas, sem fontes revogadas e com quem responde a quem.
import assert from "node:assert/strict";
import { test } from "node:test";
import { agentsMap, around, curve, fibonacci, knowledgeMap } from "./layout.ts";

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

test("acomodação orgânica: núcleo no centro, ninguém sobreposto, rápido com muitos documentos", () => {
  const areas = Array.from({ length: 11 }, (_, i) => ({ id: `a${i}`, title: `Área ${i}` }));
  const sources = Array.from({ length: 300 }, (_, i) => ({ id: `s${i}`, title: `Doc ${i}`, area: `a${i % 11}`, status: "current" as const, version: 1 }));
  const started = performance.now();
  const map = knowledgeMap(areas, sources);
  const elapsed = performance.now() - started;
  assert.ok(elapsed < 1500, `levou ${elapsed.toFixed(0)} ms`);
  assert.deepEqual(map.nodes[0]!.position, [0, 0, 0]);
  let closest = Infinity;
  for (let i = 0; i < map.nodes.length; i++)
    for (let j = i + 1; j < map.nodes.length; j++) closest = Math.min(closest, dist(map.nodes[i]!.position, map.nodes[j]!.position));
  assert.ok(closest > 0.35, `nós a ${closest.toFixed(2)} um do outro`);
  const areaNodes = map.nodes.filter((n) => n.kind === "area");
  assert.ok(areaNodes.every((n) => Math.hypot(...n.position) > 3), "áreas longe do núcleo");
  assert.ok(map.nodes.every((n) => Math.abs(n.position[1]) < Math.max(...map.nodes.map((m) => Math.hypot(m.position[0], m.position[2])))), "achatado");
});

test("linha curva: começa e termina nos nós, arqueia para fora e é sempre igual", () => {
  const points = curve([0, 0, 0], [10, 0, 0], "core>area:x");
  assert.deepEqual(points[0], [0, 0, 0]);
  assert.deepEqual(points.at(-1), [10, 0, 0]);
  const mid = points[Math.floor(points.length / 2)]!;
  assert.ok(Math.hypot(mid[1], mid[2]) > 0.5, "arqueia");
  assert.deepEqual(curve([0, 0, 0], [10, 0, 0], "core>area:x"), points);
});
