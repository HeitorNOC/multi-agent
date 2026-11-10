/** Criar ou ajustar uma rotina: nome, pedido e agenda (diária com dias da semana, ou por intervalo). */
import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ErrorNotice } from "@/components/common";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { routinesApi, type Routine, type Schedule } from "@/lib/api";
import { cn } from "@/lib/utils";

const DAYS = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];
const INTERVALS = [15, 30, 60, 120, 240, 720];

export function RoutineForm({ routine, onDone }: { routine?: Routine; onDone: () => void }) {
  const queryClient = useQueryClient();
  const initial = routine?.schedule ?? { kind: "daily", time: "08:00", weekdays: [1, 2, 3, 4, 5] };
  const [name, setName] = useState(routine?.name ?? "");
  const [goal, setGoal] = useState(routine?.goal ?? "");
  const [kind, setKind] = useState<Schedule["kind"]>(initial.kind);
  const [time, setTime] = useState(initial.kind === "daily" ? initial.time : "08:00");
  const [weekdays, setWeekdays] = useState<number[]>(initial.kind === "daily" ? (initial.weekdays ?? [0, 1, 2, 3, 4, 5, 6]) : [1, 2, 3, 4, 5]);
  const [minutes, setMinutes] = useState(initial.kind === "interval" ? initial.minutes : 60);
  const schedule: Schedule = kind === "interval" ? { kind, minutes } : { kind, time, weekdays: weekdays.length === 7 ? undefined : weekdays };
  const save = useMutation({
    mutationFn: () => (routine ? routinesApi.change(routine.id, { name, goal, schedule }) : routinesApi.create({ name, goal, schedule })),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["routines"] });
      if (routine) void queryClient.invalidateQueries({ queryKey: ["routine", routine.id] });
      onDone();
    },
  });
  const ready = name.trim().length >= 2 && goal.trim().length >= 10 && (kind === "interval" || weekdays.length > 0);
  const toggleDay = (d: number) => setWeekdays((w) => (w.includes(d) ? w.filter((x) => x !== d) : [...w, d].sort()));
  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (ready) save.mutate();
      }}
    >
      <div className="space-y-2">
        <Label htmlFor="r-name">Nome</Label>
        <Input id="r-name" maxLength={80} value={name} onChange={(e) => setName(e.target.value)} placeholder="Resumo diário de compras" />
      </div>
      <div className="space-y-2">
        <Label htmlFor="r-goal">Pedido ao Chief of Staff</Label>
        <Textarea id="r-goal" rows={3} maxLength={2000} value={goal} onChange={(e) => setGoal(e.target.value)} placeholder="Resuma as compras de fornecedores do dia anterior e aponte o que foge da política." />
      </div>
      <fieldset className="space-y-3">
        <legend className="text-sm font-medium">Quando</legend>
        <div className="flex gap-2" role="radiogroup" aria-label="Tipo de agenda">
          {(["daily", "interval"] as const).map((k) => (
            <button
              key={k}
              type="button"
              role="radio"
              aria-checked={kind === k}
              onClick={() => setKind(k)}
              className={cn("rounded-full border px-3 py-1 text-xs", kind === k ? "border-transparent bg-primary text-primary-foreground" : "hover:bg-muted")}
            >
              {k === "daily" ? "Num horário" : "Por intervalo"}
            </button>
          ))}
        </div>
        {kind === "daily" ? (
          <div className="flex flex-wrap items-center gap-3">
            <Input type="time" aria-label="Horário" className="w-32" value={time} onChange={(e) => setTime(e.target.value)} />
            <div className="flex flex-wrap gap-1" role="group" aria-label="Dias da semana">
              {DAYS.map((label, d) => (
                <button
                  key={d}
                  type="button"
                  aria-pressed={weekdays.includes(d)}
                  onClick={() => toggleDay(d)}
                  className={cn("size-9 rounded-md border text-xs", weekdays.includes(d) ? "border-transparent bg-primary text-primary-foreground" : "hover:bg-muted")}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <select aria-label="Intervalo" className="h-9 rounded-md border bg-transparent px-2 text-sm" value={minutes} onChange={(e) => setMinutes(Number(e.target.value))}>
            {INTERVALS.map((m) => (
              <option key={m} value={m}>
                A cada {m < 60 ? `${m} min` : `${m / 60} h`}
              </option>
            ))}
          </select>
        )}
      </fieldset>
      <ErrorNotice error={save.error} title="Rotina não salva" />
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" onClick={onDone}>
          Cancelar
        </Button>
        <Button type="submit" disabled={!ready || save.isPending}>
          {routine ? "Salvar" : "Criar rotina"}
        </Button>
      </div>
    </form>
  );
}
