import assert from "node:assert/strict";
import { test } from "node:test";
import { CARD, layoutTree, type TreeNode } from "./org-layout.ts";

const tree: TreeNode = {
  id: "chief",
  children: [
    { id: "dir", children: [{ id: "a", children: [] }, { id: "b", children: [] }] },
    { id: "c", children: [] },
  ],
};

test("horizontal: um nível por coluna e chefe centrado entre os subordinados", () => {
  const l = layoutTree(tree, "horizontal");
  const at = Object.fromEntries(l.nodes.map((n) => [n.id, n]));
  assert.equal(at.chief!.x, 0);
  assert.ok(at.dir!.x > at.chief!.x && at.a!.x > at.dir!.x, "níveis da esquerda para a direita");
  assert.equal(at.a!.x, at.b!.x);
  assert.equal(at.dir!.y, (at.a!.y + at.b!.y) / 2, "diretor no meio dos dois");
  assert.ok(at.c!.y > at.b!.y, "folhas sem sobrepor");
  assert.equal(l.edges.length, 4);
  assert.equal(l.width, at.a!.x + CARD.w);
});

test("vertical: um nível por linha, ligação do pé do chefe ao topo do subordinado", () => {
  const l = layoutTree(tree, "vertical");
  const at = Object.fromEntries(l.nodes.map((n) => [n.id, n]));
  assert.ok(at.dir!.y > at.chief!.y && at.a!.y > at.dir!.y);
  assert.equal(at.dir!.x, (at.a!.x + at.b!.x) / 2);
  const edge = l.edges.find((e) => e.to === "a")!;
  assert.match(edge.d, new RegExp(`^M${at.dir!.x + CARD.w / 2} ${at.dir!.y + CARD.h}V`));
  assert.ok(edge.d.endsWith(`V${at.a!.y - 2}`), "termina logo acima do cartão (espaço para a seta)");
});

test("só o Chief: um cartão, sem ligações", () => {
  const l = layoutTree({ id: "chief", children: [] }, "vertical");
  assert.deepEqual([l.nodes.length, l.edges.length, l.width, l.height], [1, 0, CARD.w, CARD.h]);
});
