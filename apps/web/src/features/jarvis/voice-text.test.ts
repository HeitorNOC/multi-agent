import assert from "node:assert/strict";
import { test } from "node:test";
import { findWake, isEcho, isStop, sentences, speakable } from "./voice-text.ts";

test("palavra de ativação, com o que vem depois, e grafias comuns do reconhecimento", () => {
  assert.deepEqual(findWake("Jarvis, qual é o resumo do dia?"), { hit: true, trailing: "qual e o resumo do dia" });
  assert.deepEqual(findWake("ei Jarvis"), { hit: true, trailing: "" });
  for (const heard of ["ok jarvis", "Djarvis", "jarves", "Jarbas me ajuda", "oi Jervis"]) assert.equal(findWake(heard).hit, true, heard);
  for (const heard of ["javascript é ótimo", "o servidor", "jardim", "Jarvisson"]) assert.equal(findWake(heard).hit, false, heard);
});

test("parar: só frases curtas de basta", () => {
  for (const s of ["Para", "pare!", "chega", "silêncio", "Jarvis para", "ok obrigado"]) assert.equal(isStop(s), true, s);
  for (const s of ["para de comprar fornecedor sem cotação", "qual o andamento", "parabéns"]) assert.equal(isStop(s), false, s);
});

test("eco: o que ele mesmo está falando não vira pedido", () => {
  const speaking = "Há um parecer aguardando sua aprovação sobre compras acima de dez mil reais.";
  assert.equal(isEcho("parecer aguardando sua aprovação", speaking), true);
  assert.equal(isEcho("quem está trabalhando agora no time", speaking), false);
  assert.equal(isEcho("compras", speaking), false, "uma palavra só não decide");
  assert.equal(isEcho("parecer aguardando", ""), false);
});

test("texto para falar e quebra em frases", () => {
  assert.equal(speakable("Veja **isto** [1] em https://x.com/a e o trabalho 123e4567-e89b-12d3-a456-426614174000 ."), "Veja isto em e o trabalho.");
  const long = "Primeira frase curta. " + "palavra ".repeat(40) + "fim. Última.";
  const parts = sentences(long, 120);
  assert.ok(parts.length >= 2);
  assert.equal(parts.join(" ").replace(/\s+/g, " "), long.trim().replace(/\s+/g, " "));
  assert.ok(parts.every((p) => p.length <= 400));
});
