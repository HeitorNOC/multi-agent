/** Avatar de persona e nomes dos agentes do time, usados por todas as telas. */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router";
import { agentsApi, conversationsApi } from "@/lib/api";
import { agentLabel } from "@/lib/format";
import { cn } from "@/lib/utils";

const AREA_COLOR: Record<string, string> = {
  executive: "bg-indigo-500/20 text-indigo-700 dark:text-indigo-300",
  marketing: "bg-pink-500/20 text-pink-700 dark:text-pink-300",
  sales: "bg-emerald-500/20 text-emerald-700 dark:text-emerald-300",
  customer: "bg-teal-500/20 text-teal-700 dark:text-teal-300",
  operations: "bg-amber-500/20 text-amber-700 dark:text-amber-300",
  finance: "bg-lime-500/20 text-lime-700 dark:text-lime-300",
  people: "bg-orange-500/20 text-orange-700 dark:text-orange-300",
  legal: "bg-slate-500/20 text-slate-700 dark:text-slate-300",
  product: "bg-violet-500/20 text-violet-700 dark:text-violet-300",
  technology: "bg-sky-500/20 text-sky-700 dark:text-sky-300",
};

export function AgentAvatar({ name, area, size = "md" }: { name: string; area: string; size?: "sm" | "md" | "lg" }) {
  const initials = name
    .split(/\s+/)
    .slice(0, 2)
    .map((p) => p.charAt(0).toUpperCase())
    .join("");
  return (
    <div
      aria-hidden
      className={cn(
        "flex shrink-0 items-center justify-center rounded-full font-semibold",
        AREA_COLOR[area] ?? "bg-muted text-muted-foreground",
        size === "sm" ? "size-7 text-xs" : size === "lg" ? "size-14 text-lg" : "size-10 text-sm",
      )}
    >
      {initials}
    </div>
  );
}

/** id do agente → "Bruno, Analista de compras". Quem saiu do time aparece pelo id formatado. */
export function useAgentNames() {
  const team = useQuery({ queryKey: ["team"], queryFn: agentsApi.team, staleTime: 30_000 });
  const byId = new Map((team.data?.agents ?? []).map((a) => [a.id, a]));
  return (id: string) => {
    const a = byId.get(id);
    return a ? `${a.name}, ${a.title}` : agentLabel(id);
  };
}

/** O time por id (para avatar e nome nas conversas da Estação). */
export function useTeamMap() {
  const team = useQuery({ queryKey: ["team"], queryFn: agentsApi.team, staleTime: 30_000 });
  return new Map((team.data?.agents ?? []).map((a) => [a.id, a]));
}

/** Abre uma conversa na Estação do agente e vai para ela. */
export function useOpenStation() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  return useMutation({
    mutationFn: (agentId: string) => conversationsApi.create(undefined, agentId),
    onSuccess: (c) => {
      void queryClient.invalidateQueries({ queryKey: ["conversations"] });
      void navigate(`/conversa/${c.id}`);
    },
  });
}
