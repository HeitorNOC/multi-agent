/** Rotinas: pedidos recorrentes ao Chief of Staff, com agenda, próximos horários e histórico. */
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarClock, Pause, Play, Plus, Zap } from "lucide-react";
import { Link } from "react-router";
import { EmptyState, ErrorNotice, LoadingRows, PageHeader, ToneBadge } from "@/components/common";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { routinesApi, type Routine, type RoutineRun } from "@/lib/api";
import { formatDateTime, JOB_STATUS, shortId } from "@/lib/format";
import { RoutineForm } from "./routine-form";

export function RoutinesPage() {
  const list = useQuery({ queryKey: ["routines"], queryFn: routinesApi.list, refetchInterval: 10_000 });
  const [editing, setEditing] = useState<Routine | "new" | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  return (
    <div className="space-y-6">
      <PageHeader
        title="Rotinas"
        description={`Pedidos que se repetem na agenda. Cada horário vira no máximo um trabalho, mesmo se a API reiniciar.${list.data ? ` Fuso: ${list.data.time_zone}.` : ""}`}
        actions={
          <Button onClick={() => setEditing("new")}>
            <Plus /> Nova rotina
          </Button>
        }
      />
      <ErrorNotice error={list.error} title="Não foi possível carregar as rotinas" />
      {list.isPending ? (
        <LoadingRows />
      ) : !list.data?.routines.length ? (
        <EmptyState icon={<CalendarClock />} title="Nenhuma rotina">
          Ex.: todo dia útil às 08:00, “resuma as compras do dia anterior e aponte o que foge da política”.
        </EmptyState>
      ) : (
        <ul className="space-y-3">
          {list.data.routines.map((r) => (
            <li key={r.id}>
              <RoutineCard routine={r} lastRun={r.last_run} onOpen={() => setOpen(r.id)} onEdit={() => setEditing(r)} />
            </li>
          ))}
        </ul>
      )}
      <Dialog open={editing !== null} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent className="max-h-[90dvh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editing === "new" ? "Nova rotina" : "Ajustar rotina"}</DialogTitle>
            <DialogDescription>Mudar a agenda recomeça a contagem a partir de agora; horários já passados não disparam.</DialogDescription>
          </DialogHeader>
          {editing !== null && <RoutineForm routine={editing === "new" ? undefined : editing} onDone={() => setEditing(null)} />}
        </DialogContent>
      </Dialog>
      {open && <RunsDialog id={open} onClose={() => setOpen(null)} />}
    </div>
  );
}

function RoutineCard({ routine: r, lastRun, onOpen, onEdit }: { routine: Routine; lastRun: RoutineRun | null; onOpen: () => void; onEdit: () => void }) {
  const queryClient = useQueryClient();
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ["routines"] });
    void queryClient.invalidateQueries({ queryKey: ["jobs"] });
  };
  const toggle = useMutation({ mutationFn: () => routinesApi.change(r.id, { enabled: !r.enabled }), onSuccess: refresh });
  const now = useMutation({ mutationFn: () => routinesApi.runNow(r.id), onSuccess: refresh });
  return (
    <Card>
      <CardContent className="space-y-3">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <p className="font-medium">{r.name}</p>
              {r.enabled ? <ToneBadge tone="success">Ativa</ToneBadge> : <ToneBadge tone="neutral">Pausada</ToneBadge>}
            </div>
            <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">{r.goal}</p>
            <p className="mt-2 text-xs">
              {r.schedule_label}
              {r.next_run_at && ` · próxima ${formatDateTime(r.next_run_at)}`}
            </p>
            {lastRun && <p className="mt-1 text-xs text-muted-foreground">Última: {runLabel(lastRun)}</p>}
          </div>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" disabled={now.isPending} onClick={() => now.mutate()}>
              <Zap /> Rodar agora
            </Button>
            <Button size="sm" variant="ghost" disabled={toggle.isPending} onClick={() => toggle.mutate()}>
              {r.enabled ? (
                <>
                  <Pause /> Pausar
                </>
              ) : (
                <>
                  <Play /> Reativar
                </>
              )}
            </Button>
            <Button size="sm" variant="ghost" onClick={onEdit}>
              Ajustar
            </Button>
            <Button size="sm" variant="ghost" onClick={onOpen}>
              Histórico
            </Button>
          </div>
        </div>
        <ErrorNotice error={toggle.error ?? now.error} />
        {now.data && now.data.status !== "admitted" && <p className="text-xs text-warning">Não abriu agora: {now.data.last_error}. Tentará de novo.</p>}
      </CardContent>
    </Card>
  );
}

function runLabel(run: RoutineRun) {
  const when = formatDateTime(run.slot);
  if (run.status === "admitted") return `${when} · ${run.job_status ? JOB_STATUS[run.job_status].label.toLowerCase() : "trabalho aberto"}`;
  if (run.status === "retrying") return `${when} · recusada (${run.last_error}); nova tentativa ${run.next_attempt_at ? formatDateTime(run.next_attempt_at) : ""}`;
  return `${when} · desistiu após ${run.attempts} tentativas (${run.last_error})`;
}

function RunsDialog({ id, onClose }: { id: string; onClose: () => void }) {
  const queryClient = useQueryClient();
  const routine = useQuery({ queryKey: ["routine", id], queryFn: () => routinesApi.get(id), refetchInterval: 10_000 });
  const [confirm, setConfirm] = useState(false);
  const archive = useMutation({
    mutationFn: () => routinesApi.archive(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["routines"] });
      onClose();
    },
  });
  const r = routine.data;
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{r?.name ?? "Rotina"}</DialogTitle>
          <DialogDescription>{r ? `${r.schedule_label} · fuso ${r.time_zone}` : ""}</DialogDescription>
        </DialogHeader>
        <ErrorNotice error={routine.error} />
        {r && (
          <div className="space-y-4 text-sm">
            {r.upcoming.length > 0 && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-sm">Próximos horários</CardTitle>
                </CardHeader>
                <CardContent className="text-muted-foreground">{r.upcoming.map(formatDateTime).join(" · ")}</CardContent>
              </Card>
            )}
            <div>
              <p className="mb-2 font-medium">Execuções</p>
              {r.runs.length ? (
                <ul className="divide-y rounded-lg border">
                  {r.runs.map((run) => (
                    <li key={run.slot} className="flex flex-col gap-1 p-3 sm:flex-row sm:items-center">
                      <span className="min-w-0 flex-1">
                        {formatDateTime(run.slot)} {run.trigger === "manual" && <span className="text-xs text-muted-foreground">(rodar agora)</span>}
                        {run.missed > 0 && <span className="block text-xs text-muted-foreground">{run.missed} horário(s) perdido(s) durante uma parada; disparou só este</span>}
                        {run.status !== "admitted" && <span className="block text-xs text-warning">{runLabel(run)}</span>}
                      </span>
                      {run.job_id && (
                        <Link to={`/trabalhos/${run.job_id}`} className="text-xs underline" onClick={onClose}>
                          #{shortId(run.job_id)} · {run.job_status ? JOB_STATUS[run.job_status].label : ""}
                        </Link>
                      )}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-muted-foreground">Ainda não rodou.</p>
              )}
            </div>
            <div className="flex justify-end">
              {confirm ? (
                <Button variant="destructive" size="sm" disabled={archive.isPending} onClick={() => archive.mutate()}>
                  Confirmar: arquivar rotina
                </Button>
              ) : (
                <Button variant="ghost" size="sm" onClick={() => setConfirm(true)}>
                  Arquivar
                </Button>
              )}
            </div>
            <ErrorNotice error={archive.error} />
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
