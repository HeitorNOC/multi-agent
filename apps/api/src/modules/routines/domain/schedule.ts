/**
 * Agenda de uma rotina: **diária** num horário (opcionalmente só em alguns dias da semana) ou
 * **por intervalo** em minutos. O horário é de parede, no fuso da instalação (IANA, por exemplo
 * "America/Sao_Paulo"); a conta é feita com `Intl`, sem depender do fuso do processo.
 */
import { ensure, invalid } from "../../../shared/errors.ts";

export type Schedule =
  | { kind: "daily"; time: string; weekdays?: number[] }
  | { kind: "interval"; minutes: number };

export const MIN_INTERVAL = 15;
const TIME = /^([01]\d|2[0-3]):([0-5]\d)$/;

/** Valida e normaliza a agenda (dias da semana únicos e ordenados, 0 = domingo). */
export function parseSchedule(input: Schedule): Schedule {
  if (input.kind === "interval") {
    ensure(Number.isInteger(input.minutes) && input.minutes >= MIN_INTERVAL && input.minutes <= 7 * 24 * 60, () =>
      invalid("invalid_schedule", `Intervalo de ${MIN_INTERVAL} minutos a 7 dias`),
    );
    return { kind: "interval", minutes: input.minutes };
  }
  ensure(TIME.test(input.time), () => invalid("invalid_schedule", "Horário no formato HH:MM"));
  const weekdays = input.weekdays === undefined ? undefined : [...new Set(input.weekdays)].sort();
  ensure(weekdays === undefined || (weekdays.length > 0 && weekdays.every((d) => Number.isInteger(d) && d >= 0 && d <= 6)), () =>
    invalid("invalid_schedule", "Dias da semana de 0 (domingo) a 6 (sábado)"),
  );
  return weekdays && weekdays.length < 7 ? { kind: "daily", time: input.time, weekdays } : { kind: "daily", time: input.time };
}

export function validTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

interface LocalParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  weekday: number;
}

const WEEKDAY: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

function partsIn(tz: string, instant: Date): LocalParts {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    weekday: "short",
  });
  const p = Object.fromEntries(fmt.formatToParts(instant).map((x) => [x.type, x.value]));
  return { year: +p.year!, month: +p.month!, day: +p.day!, hour: +p.hour!, minute: +p.minute!, weekday: WEEKDAY[p.weekday!]! };
}

/** O instante em que o relógio de parede do fuso marca Y-M-D h:m (duas passadas pela diferença do fuso). */
function wallToInstant(tz: string, y: number, m: number, d: number, h: number, min: number): Date {
  const guess = Date.UTC(y, m - 1, d, h, min);
  let instant = guess;
  for (let i = 0; i < 2; i++) {
    const p = partsIn(tz, new Date(instant));
    const shown = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute);
    instant += guess - shown;
  }
  return new Date(instant);
}

/** O primeiro horário da agenda estritamente depois de `after`. */
export function nextRun(schedule: Schedule, after: Date, tz: string): Date {
  if (schedule.kind === "interval") {
    // Intervalos alinhados ao minuto: o próximo múltiplo depois de `after`.
    const step = schedule.minutes * 60_000;
    return new Date(Math.floor(after.getTime() / step) * step + step);
  }
  const [h, m] = schedule.time.split(":").map(Number) as [number, number];
  const start = partsIn(tz, after);
  for (let offset = 0; offset <= 8; offset++) {
    const day = new Date(Date.UTC(start.year, start.month - 1, start.day + offset));
    const candidate = wallToInstant(tz, day.getUTCFullYear(), day.getUTCMonth() + 1, day.getUTCDate(), h, m);
    const weekday = partsIn(tz, candidate).weekday;
    if (candidate > after && (!schedule.weekdays || schedule.weekdays.includes(weekday))) return candidate;
  }
  throw new Error("agenda sem próximo horário");
}

/** Os próximos `count` horários depois de `after` (para mostrar na tela). */
export function upcomingRuns(schedule: Schedule, after: Date, tz: string, count = 3): Date[] {
  const out: Date[] = [];
  let at = after;
  for (let i = 0; i < count; i++) out.push((at = nextRun(schedule, at, tz)));
  return out;
}

const DAY_NAMES = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];

export function describeSchedule(s: Schedule): string {
  if (s.kind === "interval") return s.minutes % 60 === 0 ? `A cada ${s.minutes / 60} h` : `A cada ${s.minutes} min`;
  if (!s.weekdays) return `Todo dia às ${s.time}`;
  if (s.weekdays.join() === "1,2,3,4,5") return `Dias úteis às ${s.time}`;
  return `${s.weekdays.map((d) => DAY_NAMES[d]).join(", ")} às ${s.time}`;
}
