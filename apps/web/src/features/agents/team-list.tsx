/** O time atual: ajustar orientações e a quem cada um responde, ou tirar do time. */
import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Settings2 } from "lucide-react";
import { ErrorNotice } from "@/components/common";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { agentsApi, type Agent } from "@/lib/api";
import { relativeTime } from "@/lib/format";
import { AgentAvatar } from "./agent-bits";

export function TeamList({ agents, areas }: { agents: Agent[]; areas: { id: string; title: string }[] }) {
  const [editing, setEditing] = useState<Agent | null>(null);
  const areaTitle = (id: string) => areas.find((a) => a.id === id)?.title ?? id;
  const byId = new Map(agents.map((a) => [a.id, a]));
  return (
    <>
      <ul className="divide-y rounded-xl border">
        {agents.map((a) => (
          <li key={a.id} className="flex items-center gap-3 p-4">
            <AgentAvatar name={a.name} area={a.area} />
            <div className="min-w-0 flex-1">
              <p className="font-medium">
                {a.name} <span className="font-normal text-muted-foreground">· {a.title}</span>
              </p>
              <p className="text-xs text-muted-foreground">
                {areaTitle(a.area)} · responde a {a.reports_to ? (byId.get(a.reports_to)?.name ?? a.reports_to) : "Chief of Staff"} · no time {relativeTime(a.hired_at)}
                {a.instructions && " · com orientações"}
              </p>
            </div>
            <Button variant="ghost" size="sm" onClick={() => setEditing(a)} aria-label={`Ajustar ${a.name}`}>
              <Settings2 /> Ajustar
            </Button>
          </li>
        ))}
      </ul>
      {editing && <EditAgentDialog agent={editing} team={agents} onClose={() => setEditing(null)} />}
    </>
  );
}

function EditAgentDialog({ agent, team, onClose }: { agent: Agent; team: Agent[]; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [instructions, setInstructions] = useState(agent.instructions);
  const [reportsTo, setReportsTo] = useState(agent.reports_to ?? "");
  const [confirm, setConfirm] = useState(false);
  const refresh = () => {
    for (const key of ["team", "organogram", "catalog", "setup"]) void queryClient.invalidateQueries({ queryKey: [key] });
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
          <select id="e-reports" className="h-9 w-full rounded-md border bg-transparent px-2 text-sm" value={reportsTo} onChange={(e) => setReportsTo(e.target.value)}>
            <option value="">Chief of Staff</option>
            {team
              .filter((a) => a.id !== agent.id)
              .map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name} · {a.title}
                </option>
              ))}
          </select>
        </div>
        <ErrorNotice error={save.error ?? remove.error} />
        <DialogFooter className="gap-2 sm:justify-between">
          {confirm ? (
            <Button variant="destructive" disabled={remove.isPending} onClick={() => remove.mutate()}>
              Confirmar: tirar do time
            </Button>
          ) : (
            <Button variant="ghost" onClick={() => setConfirm(true)}>
              Tirar do time
            </Button>
          )}
          <Button disabled={save.isPending} onClick={() => save.mutate()}>
            Salvar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
