/**
 * Agentes: catálogo de personas por área ("Marketing & Conteúdo · 3 especialistas · 1 no time"),
 * conhecer cada um, contratar, e o time atual com orientações e a quem responde.
 */
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Plus, Users } from "lucide-react";
import { EmptyState, ErrorNotice, LoadingRows, PageHeader, ToneBadge } from "@/components/common";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { agentsApi, type AgentTemplate, type CatalogArea } from "@/lib/api";
import { cn } from "@/lib/utils";
import { AgentAvatar } from "./agent-bits";
import { CreateAgentDialog } from "./create-agent-dialog";
import { TeamList } from "./team-list";

export function useHire() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (templateId: string) => agentsApi.hire(templateId),
    onSuccess: () => {
      for (const key of ["catalog", "team", "organogram", "setup"]) void queryClient.invalidateQueries({ queryKey: [key] });
    },
  });
}

export function AgentsPage() {
  const catalog = useQuery({ queryKey: ["catalog"], queryFn: agentsApi.catalog });
  const team = useQuery({ queryKey: ["team"], queryFn: agentsApi.team });
  const areas = catalog.data?.areas ?? [];
  return (
    <div className="space-y-6">
      <PageHeader
        title="Agentes"
        description="Escolha especialistas prontos ou crie o seu. O Chief of Staff só escala quem está no seu time."
        actions={<CreateAgentDialog areas={areas} />}
      />
      <ErrorNotice error={catalog.error ?? team.error} />
      <Tabs defaultValue="catalog">
        <TabsList>
          <TabsTrigger value="catalog">Catálogo</TabsTrigger>
          <TabsTrigger value="team">No seu time {team.data ? `(${team.data.agents.length})` : ""}</TabsTrigger>
        </TabsList>
        <TabsContent value="catalog" className="mt-4">
          {catalog.isPending ? <LoadingRows /> : <Catalog areas={areas} />}
        </TabsContent>
        <TabsContent value="team" className="mt-4">
          {team.isPending ? (
            <LoadingRows />
          ) : !team.data?.agents.length ? (
            <EmptyState icon={<Users />} title="Seu time ainda está vazio">
              Contrate especialistas no catálogo. Sem time, o Chief of Staff não consegue abrir trabalhos.
            </EmptyState>
          ) : (
            <TeamList agents={team.data.agents} areas={areas} />
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}

export function Catalog({ areas, compact = false }: { areas: CatalogArea[]; compact?: boolean }) {
  const [area, setArea] = useState<string>("all");
  const [open, setOpen] = useState<AgentTemplate | null>(null);
  const shown = area === "all" ? areas : areas.filter((a) => a.id === area);
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap gap-2" role="group" aria-label="Filtrar por área">
        {[{ id: "all", title: "Todas" }, ...areas].map((a) => (
          <button
            key={a.id}
            type="button"
            onClick={() => setArea(a.id)}
            className={cn("rounded-full border px-3 py-1 text-xs transition-colors", area === a.id ? "border-transparent bg-primary text-primary-foreground" : "hover:bg-muted")}
          >
            {a.title}
          </button>
        ))}
      </div>
      {shown.map((a) => (
        <section key={a.id} className="space-y-3">
          <h2 className="text-sm font-medium">
            {a.title} <span className="font-normal text-muted-foreground">· {a.templates.length} especialistas · {a.in_team} no time</span>
          </h2>
          <ul className={cn("grid gap-3", compact ? "sm:grid-cols-2" : "sm:grid-cols-2 lg:grid-cols-3")}>
            {a.templates.map((t) => (
              <li key={t.id}>
                <PersonaCard template={t} onOpen={() => setOpen(t)} />
              </li>
            ))}
          </ul>
        </section>
      ))}
      {open && <PersonaDialog template={open} areaTitle={areas.find((a) => a.id === open.area)?.title ?? ""} onClose={() => setOpen(null)} />}
    </div>
  );
}

function PersonaCard({ template: t, onOpen }: { template: AgentTemplate; onOpen: () => void }) {
  const hireAgent = useHire();
  return (
    <div className="flex h-full flex-col gap-3 rounded-xl border bg-card p-4">
      <div className="flex items-start gap-3">
        <AgentAvatar name={t.name} area={t.area} />
        <div className="min-w-0">
          <p className="font-medium">{t.name}</p>
          <p className="text-xs text-muted-foreground">{t.title}</p>
        </div>
      </div>
      <p className="text-sm">“{t.tagline}”</p>
      <ul className="flex flex-wrap gap-1">
        {t.skills.map((s) => (
          <li key={s} className="rounded-md bg-muted px-2 py-0.5 text-[11px]">
            {s}
          </li>
        ))}
      </ul>
      <div className="mt-auto flex items-center justify-between gap-2 pt-1">
        <button type="button" onClick={onOpen} className="text-xs text-sky-600 hover:underline dark:text-sky-400">
          Conhecer →
        </button>
        {t.in_team ? (
          <ToneBadge tone="success">
            <Check /> No seu time
          </ToneBadge>
        ) : (
          <Button size="sm" variant="outline" disabled={hireAgent.isPending} onClick={() => hireAgent.mutate(t.id)}>
            <Plus /> Contratar
          </Button>
        )}
      </div>
      <ErrorNotice error={hireAgent.error} />
    </div>
  );
}

function PersonaDialog({ template: t, areaTitle, onClose }: { template: AgentTemplate; areaTitle: string; onClose: () => void }) {
  const hireAgent = useHire();
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <div className="flex items-center gap-3">
            <AgentAvatar name={t.name} area={t.area} size="lg" />
            <div>
              <DialogTitle>{t.name}</DialogTitle>
              <DialogDescription>
                {t.title} · {areaTitle}
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>
        <p className="text-sm">“{t.tagline}”</p>
        <div className="space-y-1 text-sm">
          <p className="font-medium">No que ajuda</p>
          <p className="text-muted-foreground">{t.focus}</p>
        </div>
        <div className="space-y-1 text-sm">
          <p className="font-medium">Habilidades</p>
          <p className="text-muted-foreground">{t.skills.join(" · ")}</p>
        </div>
        <p className="text-xs text-muted-foreground">Responde só com as fontes do Cérebro abertas a toda a empresa, citando cada uma.</p>
        <ErrorNotice error={hireAgent.error} />
        <DialogFooter>
          {t.in_team || hireAgent.isSuccess ? (
            <ToneBadge tone="success">
              <Check /> No seu time
            </ToneBadge>
          ) : (
            <Button disabled={hireAgent.isPending} onClick={() => hireAgent.mutate(t.id)}>
              <Plus /> Contratar {t.name}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
