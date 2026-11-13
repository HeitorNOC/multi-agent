import assert from "node:assert/strict";
import { test } from "node:test";
import { AppError } from "../../../shared/errors.ts";
import { describeSchedule, nextRun, parseSchedule, upcomingRuns } from "./schedule.ts";

const SP = "America/Sao_Paulo"; // UTC-3, sem horário de verão
const NY = "America/New_York"; // com horário de verão
const iso = (d: Date) => d.toISOString();

test("diária: mesmo dia se ainda não passou, senão no dia seguinte, no fuso da instalação", () => {
  const s = parseSchedule({ kind: "daily", time: "08:00" });
  assert.equal(iso(nextRun(s, new Date("2026-03-02T10:00:00Z"), SP)), "2026-03-02T11:00:00.000Z", "07:00 em SP → 08:00 do mesmo dia");
  assert.equal(iso(nextRun(s, new Date("2026-03-02T11:00:00Z"), SP)), "2026-03-03T11:00:00.000Z", "exatamente no horário → o próximo");
});

test("diária com dias úteis pula o fim de semana", () => {
  const s = parseSchedule({ kind: "daily", time: "09:30", weekdays: [5, 1, 2, 3, 4, 1] });
  assert.deepEqual(s, { kind: "daily", time: "09:30", weekdays: [1, 2, 3, 4, 5] });
  // 2026-03-06 é sexta; depois das 09:30 de SP, o próximo é segunda 09/03.
  assert.equal(iso(nextRun(s, new Date("2026-03-06T13:00:00Z"), SP)), "2026-03-09T12:30:00.000Z");
  assert.equal(describeSchedule(s), "Dias úteis às 09:30");
});

test("horário de verão: o horário de parede é mantido", () => {
  const s = parseSchedule({ kind: "daily", time: "08:00" });
  // Nova York muda para o horário de verão em 08/03/2026: 08:00 passa de 13:00Z para 12:00Z.
  assert.deepEqual(upcomingRuns(s, new Date("2026-03-07T00:00:00Z"), NY, 2).map(iso), ["2026-03-07T13:00:00.000Z", "2026-03-08T12:00:00.000Z"]);
});

test("intervalo alinhado ao minuto e validações", () => {
  const s = parseSchedule({ kind: "interval", minutes: 30 });
  assert.equal(iso(nextRun(s, new Date("2026-03-02T10:07:12Z"), SP)), "2026-03-02T10:30:00.000Z");
  assert.equal(describeSchedule({ kind: "interval", minutes: 120 }), "A cada 2 h");
  const code = (fn: () => unknown) => {
    try {
      fn();
      return "ok";
    } catch (e) {
      return e instanceof AppError ? e.code : String(e);
    }
  };
  assert.equal(code(() => parseSchedule({ kind: "interval", minutes: 5 })), "invalid_schedule");
  assert.equal(code(() => parseSchedule({ kind: "daily", time: "25:00" })), "invalid_schedule");
  assert.equal(code(() => parseSchedule({ kind: "daily", time: "08:00", weekdays: [7] })), "invalid_schedule");
  assert.deepEqual(parseSchedule({ kind: "daily", time: "08:00", weekdays: [0, 1, 2, 3, 4, 5, 6] }), { kind: "daily", time: "08:00" }, "todos os dias = diária simples");
});
