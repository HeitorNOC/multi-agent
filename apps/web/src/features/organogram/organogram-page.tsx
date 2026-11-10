/** Organograma: Você → Chief of Staff → time, seguindo a quem cada agente responde. */
import { useQuery } from "@tanstack/react-query";
import { Crown, MessagesSquare, Sparkles, UserRound } from "lucide-react";
import { Link } from "react-router";
import { EmptyState, ErrorNotice, LoadingRows, PageHeader } from "@/components/common";
import { Button } from "@/components/ui/button";
import { agentsApi, type OrgNode } from "@/lib/api";
import { AgentAvatar, useOpenStation } from "../agents/agent-bits";

export function OrganogramPage() {
  const org = useQuery({ queryKey: ["organogram"], queryFn: agentsApi.organogram });
  const areaTitle = (id: string) => org.data?.areas.find((a) => a.id === id)?.title ?? id;
  return (
    <div className="space-y-6">
      <PageHeader
        title="Organograma"
        description={org.data?.company ? `Quem responde a quem na ${org.data.company}. Você aprova o que sai da empresa.` : "Quem responde a quem. Você aprova o que sai da empresa."}
        actions={
          <Button asChild variant="outline">
            <Link to="/agentes">Ajustar o time</Link>
          </Button>
        }
      />
      <ErrorNotice error={org.error} />
      {org.isPending ? (
        <LoadingRows />
      ) : (
        org.data && (
          <div className="space-y-3">
            <Box icon={<UserRound />} name={org.data.top.name} title={org.data.top.title} />
            <Indent>
              <Box
                icon={<Sparkles />}
                name={org.data.chief.name}
                title={org.data.chief.title}
                action={
                  <Button asChild size="sm" variant="ghost">
                    <Link to="/conversa">
                      <MessagesSquare /> Conversar
                    </Link>
                  </Button>
                }
              />
              <Indent>
                {org.data.chief.reports.length ? (
                  <Tree nodes={org.data.chief.reports} areaTitle={areaTitle} />
                ) : (
                  <EmptyState title="Nenhum agente no time">
                    <Link to="/agentes" className="underline">
                      Contrate especialistas
                    </Link>{" "}
                    para o Chief of Staff escalar.
                  </EmptyState>
                )}
              </Indent>
            </Indent>
          </div>
        )
      )}
    </div>
  );
}

function Tree({ nodes, areaTitle }: { nodes: OrgNode[]; areaTitle: (id: string) => string }) {
  const station = useOpenStation();
  return (
    <ul className="space-y-3">
      {nodes.map((n) => (
        <li key={n.id} className="space-y-3">
          <Box
            avatar={<AgentAvatar name={n.name} area={n.area} />}
            name={n.name}
            title={`${n.title} · ${areaTitle(n.area)}`}
            action={
              <Button size="sm" variant="ghost" disabled={station.isPending} onClick={() => station.mutate(n.id)}>
                <MessagesSquare /> Estação
              </Button>
            }
          />
          {n.reports.length > 0 && (
            <Indent>
              <Tree nodes={n.reports} areaTitle={areaTitle} />
            </Indent>
          )}
        </li>
      ))}
    </ul>
  );
}

function Indent({ children }: { children: React.ReactNode }) {
  return <div className="space-y-3 border-l pl-4 sm:pl-6">{children}</div>;
}

function Box({ icon, avatar, name, title, action }: { icon?: React.ReactNode; avatar?: React.ReactNode; name: string; title: string; action?: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3 rounded-xl border bg-card p-3">
      {avatar ?? <div className="flex size-10 items-center justify-center rounded-full bg-sidebar-primary text-sidebar-primary-foreground [&>svg]:size-5">{icon ?? <Crown />}</div>}
      <div className="min-w-0 flex-1">
        <p className="font-medium">{name}</p>
        <p className="text-xs text-muted-foreground">{title}</p>
      </div>
      {action}
    </div>
  );
}
