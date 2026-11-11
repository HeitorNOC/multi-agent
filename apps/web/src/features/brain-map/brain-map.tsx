/**
 * Mapa 3D do Cérebro e da rede de agentes, como na v1: núcleo no centro, áreas ao redor e, em volta
 * delas, os documentos (Conhecimento) ou os agentes (Agentes), com quem está trabalhando aceso.
 *
 * Dados das telas que já existem (fontes, time, trabalhos); a cena 3D é carregada só ao abrir.
 * Sem WebGL, mostra o aviso e a lista continua disponível.
 */
import { lazy, Suspense, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ErrorNotice, LoadingRows } from "@/components/common";
import { Button } from "@/components/ui/button";
import { agentsApi, jobsApi, knowledgeApi } from "@/lib/api";
import { cn } from "@/lib/utils";
import { SourceDialog } from "../knowledge/source-dialog";
import { useOpenStation } from "../agents/agent-bits";
import { agentsMap, knowledgeMap, type MapAgent, type MapNode } from "./layout";

const BrainScene = lazy(() => import("./brain-scene"));

type Mode = "knowledge" | "agents";

const LEGEND: Record<Mode, { color: string; label: string }[]> = {
  knowledge: [
    { color: "#5eead4", label: "Vigente" },
    { color: "#a78bfa", label: "Histórico ou ainda não vigente" },
  ],
  agents: [
    { color: "#7dd3fc", label: "Disponível" },
    { color: "#fb923c", label: "Trabalhando" },
    { color: "#facc15", label: "Aguardando você" },
    { color: "#4ade80", label: "Concluiu hoje" },
  ],
};

const webgl = () => {
  try {
    const canvas = document.createElement("canvas");
    return !!(canvas.getContext("webgl2") ?? canvas.getContext("webgl"));
  } catch {
    return false;
  }
};

export function BrainMap({ initial = "knowledge" }: { initial?: Mode }) {
  const [mode, setMode] = useState<Mode>(initial);
  const [selected, setSelected] = useState<MapNode | null>(null);
  const sources = useQuery({ queryKey: ["sources"], queryFn: knowledgeApi.list });
  const team = useQuery({ queryKey: ["team"], queryFn: agentsApi.team });
  const catalog = useQuery({ queryKey: ["catalog"], queryFn: agentsApi.catalog });
  // Quem está trabalhando: atualiza enquanto houver trabalho andando.
  const jobs = useQuery({
    queryKey: ["jobs"],
    queryFn: jobsApi.list,
    enabled: mode === "agents",
    refetchInterval: (q) => (q.state.data?.jobs.some((j) => ["queued", "running"].includes(j.status)) ? 4000 : false),
  });
  const station = useOpenStation();
  const supported = useMemo(webgl, []);

  const graph = useMemo(() => {
    if (mode === "knowledge") {
      const s = sources.data;
      if (!s) return null;
      return knowledgeMap(
        s.areas,
        s.sources.map((x) => ({ id: x.id, title: x.title, area: x.area, status: x.status, version: x.current_version ?? x.latest_version, format: x.format?.label })),
      );
    }
    if (!team.data || !catalog.data) return null;
    const today = new Date().toISOString().slice(0, 10);
    const activity = new Map<string, MapAgent["activity"]>();
    for (const j of jobs.data?.jobs ?? []) {
      const state: MapAgent["activity"] | null =
        j.status === "running" || j.status === "queued" ? "running" : j.status === "awaiting_approval" ? "waiting" : j.status === "completed" && j.created_at.startsWith(today) ? "done" : null;
      if (!state) continue;
      for (const a of j.plan?.agents ?? []) {
        const prev = activity.get(a);
        // Trabalhando > aguardando > concluído.
        if (!prev || (prev === "done" && state !== "done") || (prev === "waiting" && state === "running")) activity.set(a, state);
      }
    }
    return agentsMap(
      catalog.data.areas.map((a) => ({ id: a.id, title: a.title })),
      team.data.agents.map((a) => ({ id: a.id, name: a.name, title: a.title, area: a.area, reportsTo: a.reports_to, activity: activity.get(a.id) ?? "idle" })),
    );
  }, [mode, sources.data, team.data, catalog.data, jobs.data]);

  const error = mode === "knowledge" ? sources.error : (team.error ?? catalog.error);
  const counts = graph ? graph.nodes.filter((n) => n.kind === (mode === "knowledge" ? "source" : "agent")).length : 0;
  return (
    <section className="overflow-hidden rounded-xl border bg-[radial-gradient(ellipse_at_center,#0c2a4a_0%,#07111f_70%)] text-slate-100">
      <div className="flex flex-wrap items-center gap-2 border-b border-white/10 p-3">
        <div className="flex rounded-lg border border-white/15 p-0.5" role="tablist" aria-label="O que mostrar">
          {(
            [
              ["knowledge", "Conhecimento"],
              ["agents", "Agentes"],
            ] as const
          ).map(([m, label]) => (
            <button
              key={m}
              type="button"
              role="tab"
              aria-selected={mode === m}
              onClick={() => {
                setMode(m);
                setSelected(null);
              }}
              className={cn("rounded-md px-3 py-1 text-sm", mode === m ? "bg-white/15 font-medium" : "text-slate-300 hover:bg-white/5")}
            >
              {label}
            </button>
          ))}
        </div>
        <p className="text-xs text-slate-300">Arraste para girar, role para aproximar e clique num {mode === "knowledge" ? "documento" : "agente"}.</p>
        <ul className="ml-auto flex flex-wrap gap-3 text-xs text-slate-300">
          {LEGEND[mode].map((l) => (
            <li key={l.label} className="inline-flex items-center gap-1">
              <span className="size-2 rounded-full" style={{ background: l.color }} /> {l.label}
            </li>
          ))}
        </ul>
      </div>
      <div className="relative h-[460px] sm:h-[560px]">
        {error ? (
          <div className="p-4">
            <ErrorNotice error={error} />
          </div>
        ) : !supported ? (
          <p className="p-6 text-sm text-slate-300">Este navegador não tem WebGL, então o mapa 3D não abre. A lista continua disponível na aba ao lado.</p>
        ) : !graph ? (
          <div className="p-4">
            <LoadingRows rows={3} />
          </div>
        ) : counts === 0 ? (
          <p className="p-6 text-sm text-slate-300">{mode === "knowledge" ? "O Cérebro ainda não tem documentos." : "O time ainda não tem agentes. Contrate em Agentes."}</p>
        ) : (
          <Suspense fallback={<p className="p-6 text-sm text-slate-300">Abrindo o mapa…</p>}>
            <BrainScene nodes={graph.nodes} edges={graph.edges} selected={selected?.id ?? null} onSelect={setSelected} />
            {/* O núcleo fica sempre no centro da cena (a câmera gira em volta dele). */}
            <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center">
              <span className="text-sm font-semibold tracking-[0.25em] text-white drop-shadow">CÉREBRO</span>
              <span className="text-[10px] uppercase tracking-widest text-sky-100/80">{mode === "knowledge" ? "acervo versionado" : "Chief of Staff"}</span>
            </div>
          </Suspense>
        )}
        {selected?.kind === "agent" && (
          <div className="absolute bottom-3 left-3 right-3 flex flex-wrap items-center gap-2 rounded-lg border border-white/15 bg-slate-950/80 p-3 text-sm backdrop-blur sm:right-auto">
            <div className="min-w-0">
              <p className="font-medium">{selected.label}</p>
              <p className="text-xs text-slate-300">{selected.sublabel}</p>
            </div>
            <Button size="sm" disabled={station.isPending} onClick={() => station.mutate(selected.ref!)}>
              Abrir a Estação
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setSelected(null)}>
              Fechar
            </Button>
          </div>
        )}
      </div>
      <p className="border-t border-white/10 px-3 py-2 text-xs text-slate-300">
        {mode === "knowledge"
          ? `${counts} documento(s) em ${graph?.nodes.filter((n) => n.kind === "area").length ?? 0} área(s)`
          : `${counts} agente(s) no time · ${graph?.nodes.filter((n) => n.kind === "agent" && n.state === "running").length ?? 0} trabalhando agora`}
      </p>
      {selected?.kind === "source" && sources.data && <SourceDialog id={selected.ref!} areas={sources.data.areas} onClose={() => setSelected(null)} />}
    </section>
  );
}
