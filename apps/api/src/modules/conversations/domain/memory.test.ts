import assert from "node:assert/strict";
import { test } from "node:test";
import { addDecisions, asksDecisions, recallOlder, statedDecisions, summarizeOlder, withinBudget } from "./memory.ts";
import type { Message } from "./conversation.ts";

const msg = (seq: number, role: "user" | "chief", text: string, jobId: string | null = null): Message =>
  ({ seq, conversationId: "c", role, text, jobId, clientId: null, replyTo: null, citations: null, attachments: null, createdAt: "2026-03-01T10:00:00.000Z" }) as unknown as Message;

test("decisões afirmadas na conversa e pergunta sobre o que foi decidido", () => {
  assert.deepEqual(statedDecisions("Ótimo. Fica decidido que vamos usar Kafka para os eventos. Obrigado!"), ["Fica decidido que vamos usar Kafka para os eventos."]);
  assert.deepEqual(statedDecisions("Vamos seguir com o fornecedor B."), ["Vamos seguir com o fornecedor B."]);
  assert.deepEqual(statedDecisions("Qual o andamento do trabalho?"), []);
  assert.deepEqual(statedDecisions("O que decidimos até agora?"), [], "pergunta não é decisão");
  assert.equal(asksDecisions("O que decidimos até agora?"), true);
  assert.equal(asksDecisions("Quais as decisões tomadas?"), true);
  assert.equal(asksDecisions("Decida por mim"), false);
});

test("decisões sem repetição e só as mais recentes", () => {
  const d = (text: string, seq: number) => ({ text, kind: "stated" as const, seq, at: "x" });
  const merged = addDecisions([d("Usar Kafka", 1)], [d("usar kafka", 2), d("Prazo de 30 dias", 3)]);
  assert.deepEqual(merged.map((x) => x.text), ["Usar Kafka", "Prazo de 30 dias"]);
  assert.equal(addDecisions([], Array.from({ length: 60 }, (_, i) => d(`Decisão ${i}`, i))).length, 40);
});

test("resumo das mensagens antigas e lembrança do que volta a importar", () => {
  const messages = [
    msg(1, "user", "Quero implementar o módulo de WebChat com fila Kafka para os eventos. Detalhe."),
    msg(2, "chief", "Abri o trabalho do WebChat.", "j1"),
    ...Array.from({ length: 24 }, (_, i) => msg(3 + i, i % 2 ? "chief" : "user", `Mensagem recente ${i} sobre outro assunto qualquer.`)),
  ];
  const { summary, upTo } = summarizeOlder(messages);
  assert.equal(upTo, 2);
  assert.equal(summary, "Gestor: Quero implementar o módulo de WebChat com fila Kafka para os eventos.\nChief: abriu trabalho — Abri o trabalho do WebChat.");
  assert.deepEqual(recallOlder(messages, "E a fila Kafka do WebChat, como ficou?").map((m) => m.de), ["gestor"]);
  assert.deepEqual(recallOlder(messages.slice(2), "fila Kafka"), [], "dentro da janela não precisa lembrar");
});

test("orçamento de contexto: prioridade, e listas cortadas pelo fim", () => {
  const out = withinBudget<{ a: string; b: string[]; c: string }>(
    [
      { key: "a", value: "x".repeat(50), priority: 0 },
      { key: "b", value: ["1".repeat(20), "2".repeat(20), "3".repeat(20)], priority: 1 },
      { key: "c", value: "y".repeat(100), priority: 2 },
    ],
    110,
  );
  assert.equal(out.a, "x".repeat(50));
  assert.deepEqual(out.b, ["2".repeat(20), "3".repeat(20)]);
  assert.equal(out.c, null);
});
