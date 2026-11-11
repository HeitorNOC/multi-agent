/** O time atual: o que cada um está fazendo, ajustar orientações e a quem responde, ou tirar do time. */
import { useState, type ReactNode } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { MessagesSquare, Settings2, Sparkles, UserMinus } from "lucide-react";
import { Link } from "react-router";
import { ConfirmAction, DangerZone, ErrorNotice, ToneBadge } from "@/components/common";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { NativeSelect } from "@/components/ui/native-select";
import { agentsApi, type ActivityJob, type ActivityStatus, type Agent } from "@/lib/api";
import { relativeTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import { ACTIVITY_STATUS, Milestones, StatusDot, formatDuration, useTeamActivity } from "./activity";
import { AgentAvatar, RoleBadge, useOpenStation } from "./agent-bits";

// Colunas quando a própria lista tem largura para elas (container query, não a janela: o menu lateral ocupa espaço).
const COLUMNS = "@[68rem]:grid-cols-[minmax(14rem,2fr)_8.5rem_minmax(12rem,2fr)_4.5rem_6rem_7rem_7.5rem]";

/**
 * Lista operacional do time (como na v1): status, o que cada um está fazendo, marcos do trabalho
 * atual e tempo observado/restante. O Chief of Staff vem primeiro.
 */
export function TeamList({ agents, areas }: { agents: Agent[]; areas: { id: string; title: string }[] }) {
  const [editing, setEditing] = useState<Agent | null>(null);
  const station = useOpenStation();
  const activity = useTeamActivity();
  const areaTitle = (id: string) => areas.find((a) => a.id === id)?.title ?? id;
  const byId = new Map(agents.map((a) => [a.id, a]));
  const now = new Map((activity.data?.agents ?? []).map((a) => [a.id, a]));
  const chief = activity.data?.chief;
  return (
    <>
      <ErrorNotice error={activity.error} />
      <div className="@container overflow-hidden rounded-xl border">
        <div className={cn("hidden gap-3 border-b bg-muted/40 px-4 py-2 text-xs font-medium text-muted-foreground @[68rem]:grid", COLUMNS)} aria-hidden>
          <span>Agente</span>
          <span>Status</span>
          <span>Atividade</span>
          <span>Marcos</span>
          <span>Tempo observado</span>
          <span>Tempo restante</span>
          <span />
        </div>
        <ul className="divide-y" aria-label="Lista operacional dos agentes">
          <Row
            who={
              <>
                <div className="flex size-10 shrink-0 items-center justify-center rounded-full bg-sidebar-primary text-sidebar-primary-foreground">
                  <Sparkles className="size-5" />
                </div>
                <div className="min-w-0">
                  <p className="font-medium">Chief of Staff</p>
                  <p className="text-xs text-muted-foreground">Coordenação · escolhe os especialistas e consolida o parecer</p>
                </div>
              </>
            }
            status={chief?.status ?? "idle"}
            activity={chief?.activity ?? "—"}
            job={chief?.job ?? null}
            milestones={chief?.milestones ?? { done: 0, total: 3 }}
            actions={
              <Button asChild variant="ghost" size="sm">
                <Link to="/jarvis">
                  <MessagesSquare /> Conversar
                </Link>
              </Button>
            }
          />
          {agents.map((a) => {
            const x = now.get(a.id);
            return (
              <Row
                key={a.id}
                who={
                  <>
                    <AgentAvatar name={a.name} area={a.area} />
                    <div className="min-w-0">
                      <p className="flex flex-wrap items-center gap-x-1.5 font-medium">
                        {a.name} <span className="font-normal text-muted-foreground">· {a.title}</span> <RoleBadge role={a.role} />
                        {a.engagement === "job" && (
                          <Link
                            to={a.engaged_job ? `/trabalhos/${a.engaged_job}` : "/trabalhos"}
                            className="rounded-full bg-violet-500/15 px-1.5 py-px text-[10px] font-medium uppercase tracking-wide text-violet-700 hover:underline dark:text-violet-300"
                            title="Sai do time quando o trabalho terminar"
                          >
                            Só neste trabalho
                          </Link>
                        )}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {areaTitle(a.area)} · responde a {a.reports_to ? (byId.get(a.reports_to)?.name ?? a.reports_to) : "Chief of Staff"} · no time {relativeTime(a.hired_at)}
                        {a.instructions && " · com orientações"}
                        {a.hired_by === "chief" && " · trazido pelo Chief"}
                      </p>
                    </div>
                  </>
                }
                status={x?.status ?? "idle"}
                activity={x?.activity ?? "Sem participação em trabalhos agora"}
                job={x?.job ?? null}
                milestones={x?.milestones ?? { done: 0, total: 3 }}
                elapsed={x?.elapsed_ms ?? null}
                remaining={x?.remaining_ms ?? null}
                estimable={x?.status === "running"}
                actions={
                  <>
                    <Button variant="ghost" size="sm" disabled={station.isPending} onClick={() => station.mutate(a.id)} aria-label={`Abrir a Estação de ${a.name}`}>
                      <MessagesSquare /> Estação
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => setEditing(a)} aria-label={`Ajustar ${a.name}`}>
                      <Settings2 /> Ajustar
                    </Button>
                  </>
                }
              />
            );
          })}
        </ul>
      </div>
      <p className="mt-2 text-xs text-muted-foreground">
        Marcos de cada especialista: designado pelo Chief, pesquisa iniciada e achados entregues. O tempo restante usa a mediana de pelo menos três participações anteriores do mesmo agente.
      </p>
      {editing && <EditAgentDialog agent={editing} team={agents} onClose={() => setEditing(null)} />}
    </>
  );
}

function Row(props: {
  who: ReactNode;
  status: ActivityStatus;
  activity: string;
  job: ActivityJob | null;
  milestones: { done: number; total: number };
  elapsed?: number | null;
  remaining?: number | null;
  estimable?: boolean;
  actions: ReactNode;
}) {
  const s = ACTIVITY_STATUS[props.status];
  const active = props.status !== "idle";
  return (
    <li className={cn("grid gap-3 px-4 py-3 @[68rem]:items-center", COLUMNS, active && "bg-muted/20")}>
      <div className="flex min-w-0 items-center gap-3">{props.who}</div>
      <div>
        <ToneBadge tone={s.tone} className="gap-1.5">
          <StatusDot status={props.status} /> {s.label}
        </ToneBadge>
      </div>
      <div className="min-w-0 text-sm">
        <p className={cn(!active && "text-muted-foreground")}>{props.activity}</p>
        {props.job && (
          <Link to={`/trabalhos/${props.job.id}`} className="line-clamp-1 text-xs text-sky-600 hover:underline dark:text-sky-400">
            {props.job.goal}
          </Link>
        )}
      </div>
      <div className="flex items-center gap-4 @[68rem]:contents">
        <Milestones {...props.milestones} status={props.status} />
        <span className="text-sm">
          <span className="text-xs text-muted-foreground @[68rem]:hidden">Observado: </span>
          {props.elapsed != null ? formatDuration(props.elapsed) : "—"}
        </span>
        <span className="text-sm">
          <span className="text-xs text-muted-foreground @[68rem]:hidden">Restante: </span>
          {props.remaining != null ? formatDuration(props.remaining) : props.estimable ? <span className="text-xs text-muted-foreground">Histórico insuficiente</span> : "—"}
        </span>
      </div>
      <div className="flex flex-wrap gap-1 @[68rem]:flex-col @[68rem]:items-end">{props.actions}</div>
    </li>
  );
}

export function EditAgentDialog({ agent, team, onClose }: { agent: Agent; team: Agent[]; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [instructions, setInstructions] = useState(agent.instructions);
  const [reportsTo, setReportsTo] = useState(agent.reports_to ?? "");
  const refresh = () => {
    for (const key of ["team", "organogram", "catalog", "setup", "agent-activity"]) void queryClient.invalidateQueries({ queryKey: [key] });
  };
  const save = useMutation({
    mutationFn: () => agentsApi.change(agent.id, { instructions, reports_to: reportsTo || null }),
    onSuccess: () => {
      refresh();
      onClose();
    },
  });
  const remove = useMutation({
    mutationFn: () => agentsApi.remove(agent.id),
    onSuccess: () => {
      refresh();
      onClose();
    },
  });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {agent.name} · {agent.title}
          </DialogTitle>
          <DialogDescription>{agent.focus}</DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <Label htmlFor="e-instructions">Orientações da empresa</Label>
          <Textarea id="e-instructions" rows={4} maxLength={1500} value={instructions} onChange={(e) => setInstructions(e.target.value)} placeholder="Ex.: Compare sempre pelo menos três fornecedores." />
          <p className="text-xs text-muted-foreground">Valem em todo trabalho. As regras de evidência (só o Cérebro, sempre citado) continuam acima delas.</p>
        </div>
        <div className="space-y-2">
          <Label htmlFor="e-reports">Responde a</Label>
          <NativeSelect id="e-reports" value={reportsTo} onChange={(e) => setReportsTo(e.target.value)}>
            <option value="">Chief of Staff</option>
            {team
              .filter((a) => a.id !== agent.id)
              .map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name} · {a.title}
                </option>
              ))}
          </NativeSelect>
        </div>
        <ErrorNotice error={save.error} title="Ajuste não salvo" />
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button disabled={save.isPending} onClick={() => save.mutate()}>
            {save.isPending ? "Salvando…" : "Salvar"}
          </Button>
        </DialogFooter>
        <DangerZone action={<ConfirmAction icon={<UserMinus />} label="Tirar do time" confirmLabel="Confirmar" pending={remove.isPending} onConfirm={() => remove.mutate()} />}>
          {agent.name} sai do time e deixa de receber trabalhos. O histórico do que já fez continua guardado.
        </DangerZone>
        <ErrorNotice error={remove.error} />
      </DialogContent>
    </Dialog>
  );
}
