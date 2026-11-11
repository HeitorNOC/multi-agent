/**
 * O que cada agente está fazendo agora, compartilhado pela lista operacional, pelo organograma,
 * pelo mapa 3D e pelo Jarvis. Atualiza sozinho enquanto alguém estiver trabalhando.
 */
import { useQuery } from "@tanstack/react-query";
import { agentsApi, type ActivityStatus, type TeamActivity } from "@/lib/api";
import type { Tone } from "@/lib/format";
import { cn } from "@/lib/utils";

const busy = (s: ActivityStatus) => s === "running" || s === "assigned";

export function useTeamActivity() {
  return useQuery({
    queryKey: ["agent-activity"],
    queryFn: agentsApi.activity,
    refetchInterval: (q) => {
      const d = q.state.data as TeamActivity | undefined;
      return d && (busy(d.chief.status) || d.agents.some((a) => busy(a.status))) ? 3000 : 15_000;
    },
  });
}

export const ACTIVITY_STATUS: Record<ActivityStatus, { label: string; tone: Tone; color: string }> = {
  idle: { label: "Disponível", tone: "neutral", color: "#a8a29e" },
  assigned: { label: "Designado", tone: "info", color: "#38bdf8" },
  running: { label: "Em execução", tone: "warning", color: "#fb923c" },
  waiting: { label: "Aguardando você", tone: "warning", color: "#facc15" },
  done: { label: "Concluído", tone: "success", color: "#4ade80" },
  blocked: { label: "Parado", tone: "danger", color: "#f87171" },
};

/** "11,8 s", "3 min 05 s", "1 h 12 min". */
export function formatDuration(ms: number) {
  const s = ms / 1000;
  if (s < 60) return `${s.toLocaleString("pt-BR", { maximumFractionDigits: 1 })} s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} min ${String(Math.floor(s % 60)).padStart(2, "0")} s`;
  return `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, "0")} min`;
}

/** Barra de marcos (designado → pesquisa → achados), com o número embaixo. */
export function Milestones({ done, total, status }: { done: number; total: number; status: ActivityStatus }) {
  if (status === "idle") return <span className="text-muted-foreground">—</span>;
  return (
    <div className="w-16" role="img" aria-label={`${done} de ${total} marcos`}>
      <div className="h-1.5 overflow-hidden rounded-full bg-muted">
        <div className={cn("h-full rounded-full transition-all", status === "blocked" ? "bg-red-400" : "bg-teal-400")} style={{ width: `${(done / total) * 100}%` }} />
      </div>
      <p className="mt-0.5 text-[11px] text-muted-foreground">
        {done}/{total}
      </p>
    </div>
  );
}

/** Ponto colorido do status, que pulsa enquanto trabalha. */
export function StatusDot({ status, className }: { status: ActivityStatus; className?: string }) {
  return (
    <span
      aria-hidden
      className={cn("inline-block size-2 shrink-0 rounded-full", busy(status) && "motion-safe:animate-pulse", className)}
      style={{ background: ACTIVITY_STATUS[status].color }}
    />
  );
}
