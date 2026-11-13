/**
 * Consumo do modelo por dia: uma série (chamadas ou tokens), barras finas de uma cor validada,
 * dica ao passar o mouse ou focar, rótulo só no maior valor e uma tabela equivalente.
 */
import { useState } from "react";
import { cn } from "@/lib/utils";

export interface UsageDay {
  date: string;
  calls: number;
  input_tokens: number;
  output_tokens: number;
}

type Measure = "calls" | "tokens";

const weekday = (date: string) => new Intl.DateTimeFormat("pt-BR", { weekday: "short", timeZone: "UTC" }).format(new Date(`${date}T12:00:00Z`)).replace(".", "");
const dayMonth = (date: string) => `${date.slice(8, 10)}/${date.slice(5, 7)}`;
const num = (n: number) => new Intl.NumberFormat("pt-BR").format(n);
const value = (d: UsageDay, m: Measure) => (m === "calls" ? d.calls : d.input_tokens + d.output_tokens);

export function UsageChart({ days }: { days: UsageDay[] }) {
  const [measure, setMeasure] = useState<Measure>("calls");
  const [hover, setHover] = useState<number | null>(null);
  const values = days.map((d) => value(d, measure));
  const max = Math.max(1, ...values);
  const peak = values.indexOf(Math.max(...values));
  const total = values.reduce((a, b) => a + b, 0);
  const label = measure === "calls" ? "chamadas" : "tokens";
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">
          {num(total)} {label} em {days.length} dias
        </p>
        <div className="flex gap-1" role="radiogroup" aria-label="Medida">
          {(["calls", "tokens"] as const).map((m) => (
            <button
              key={m}
              type="button"
              role="radio"
              aria-checked={measure === m}
              onClick={() => setMeasure(m)}
              className={cn("rounded-full border px-3 py-0.5 text-xs", measure === m ? "border-transparent bg-primary text-primary-foreground" : "hover:bg-muted")}
            >
              {m === "calls" ? "Chamadas" : "Tokens"}
            </button>
          ))}
        </div>
      </div>
      <div className="relative" onMouseLeave={() => setHover(null)}>
        {/* Linha de base e a grade mínima ficam recessivas; as barras partem da base. */}
        <div className="flex h-40 items-end gap-2 border-b border-border px-1" role="img" aria-label={`Consumo do modelo por dia, em ${label}. Tabela equivalente abaixo.`}>
          {days.map((d, i) => {
            const v = values[i]!;
            const h = v === 0 ? 0 : Math.max(2, (v / max) * 100);
            return (
              <button
                key={d.date}
                type="button"
                aria-label={`${weekday(d.date)} ${dayMonth(d.date)}: ${num(v)} ${label}`}
                onMouseEnter={() => setHover(i)}
                onFocus={() => setHover(i)}
                onBlur={() => setHover(null)}
                className="group relative flex h-full flex-1 items-end justify-center focus-visible:outline-none"
              >
                {i === peak && v > 0 && <span className="absolute text-[11px] tabular-nums text-muted-foreground" style={{ bottom: `calc(${h}% + 4px)` }}>{num(v)}</span>}
                <span
                  className={cn("w-full max-w-8 rounded-t bg-chart-1 transition-opacity", hover !== null && hover !== i && "opacity-40", "group-focus-visible:ring-2 group-focus-visible:ring-ring")}
                  style={{ height: `${h}%` }}
                />
              </button>
            );
          })}
        </div>
        {hover !== null && (
          <div
            className={cn(
              "pointer-events-none absolute -top-2 z-10 -translate-y-full whitespace-nowrap rounded-md border bg-popover px-2 py-1 text-xs text-popover-foreground shadow",
              // Nas pontas, a dica alinha para dentro do gráfico em vez de sair pela borda.
              hover === 0 ? "translate-x-0" : hover === days.length - 1 ? "-translate-x-full" : "-translate-x-1/2",
            )}
            style={{ left: `${((hover === 0 ? 0 : hover === days.length - 1 ? hover + 1 : hover + 0.5) / days.length) * 100}%` }}
          >
            <p className="font-medium">
              {weekday(days[hover]!.date)} {dayMonth(days[hover]!.date)}
            </p>
            <p>{num(days[hover]!.calls)} chamadas</p>
            <p>
              {num(days[hover]!.input_tokens)} entrada · {num(days[hover]!.output_tokens)} saída
            </p>
          </div>
        )}
        <div className="mt-1 flex gap-2 px-1">
          {days.map((d) => (
            <span key={d.date} className="flex-1 text-center text-[11px] text-muted-foreground">
              {weekday(d.date)}
            </span>
          ))}
        </div>
      </div>
      <details className="text-xs">
        <summary className="cursor-pointer text-muted-foreground">Ver como tabela</summary>
        <table className="mt-2 w-full text-left tabular-nums">
          <thead className="text-muted-foreground">
            <tr>
              <th className="py-1 font-normal">Dia</th>
              <th className="py-1 font-normal">Chamadas</th>
              <th className="py-1 font-normal">Tokens de entrada</th>
              <th className="py-1 font-normal">Tokens de saída</th>
            </tr>
          </thead>
          <tbody>
            {days.map((d) => (
              <tr key={d.date} className="border-t">
                <td className="py-1">
                  {weekday(d.date)} {dayMonth(d.date)}
                </td>
                <td className="py-1">{num(d.calls)}</td>
                <td className="py-1">{num(d.input_tokens)}</td>
                <td className="py-1">{num(d.output_tokens)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </div>
  );
}
