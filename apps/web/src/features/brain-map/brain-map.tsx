/**
 * Mapa 3D do Cérebro e da rede de agentes, como na v1: núcleo no centro, áreas ao redor e, em volta
 * delas, os documentos (Cérebro) ou os agentes (Agentes e Jarvis), com quem está trabalhando aceso.
 *
 * Cada tela escolhe o modo. `variant="immersive"` ocupa todo o espaço do pai, sem moldura (Jarvis).
 * Dados das telas que já existem (fontes, time, atividade); a cena 3D é carregada só ao abrir.
 * Sem WebGL, mostra o aviso e a lista continua disponível.
 */
import { lazy, Suspense, useMemo, useState, type ReactNode, type RefObject } from "react";
import { useQuery } from "@tanstack/react-query";
import { ErrorNotice, LoadingRows } from "@/components/common";
import { Button } from "@/components/ui/button";
import { NativeSelect } from "@/components/ui/native-select";
import { agentsApi, knowledgeApi, type ActivityStatus } from "@/lib/api";
import { cn } from "@/lib/utils";
import { SourceDialog } from "../knowledge/source-dialog";
import { useOpenStation } from "../agents/agent-bits";
import { useTeamActivity } from "../agents/activity";
import { agentsMap, knowledgeMap, type MapAgent, type MapNode } from "./layout";
import type { ReactorSignal } from "./reactor";

const BrainScene = lazy(() => import("./brain-scene"));

type Mode = "knowledge" | "agents";

const LEGEND: Record<Mode, { color: string; label: string }[]> = {
  knowledge: [
    { color: "#5eead4", label: "Área" },
    { color: "#a7bdb8", label: "Vigente" },
    { color: "#9d8cf0", label: "Histórico ou ainda não vigente" },
  ],
  agents: [
    { color: "#5eead4", label: "Área" },
    { color: "#a8a29e", label: "Disponível" },
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

/** Status da atividade → estado do nó no mapa (parado também pede você). */
const MAP_STATE: Record<ActivityStatus, MapAgent["activity"]> = { idle: "idle", assigned: "running", running: "running", waiting: "waiting", blocked: "waiting", done: "done" };

export function BrainMap({
  mode,
  variant = "card",
  core,
  onCore,
  toolbar,
  children,
  sceneInset,
  reactor,
  bare = false,
}: {
  mode: Mode;
  variant?: "card" | "immersive";
  /** Rótulo do núcleo no modo Agentes (o Jarvis usa o próprio nome). */
  core?: { label: string; sublabel: string };
  /** Clique no núcleo (o Jarvis abre a conversa); sem isto, recentra. */
  onCore?: () => void;
  /** Botões extras na barra do mapa. */
  toolbar?: ReactNode;
  /** Camada sobre o mapa (painel de conversa do Jarvis). */
  children?: ReactNode;
  /** Larguras (px) cobertas por painéis à esquerda e à direita: a cena se centra no espaço que sobra. */
  sceneInset?: { left?: number; right?: number };
  /** Jarvis: núcleo como reator, guiado pela voz (ver `reactor.tsx`). */
  reactor?: RefObject<ReactorSignal | null>;
  /** Jarvis: esconde a barra do mapa (seleção, legenda) para a cena ocupar tudo. */
  bare?: boolean;
}) {
  const [selected, setSelected] = useState<MapNode | null>(null);
  // Para onde a câmera olha: um nó ou a vista inteira (o contador refaz o "Recentrar").
  const [focus, setFocus] = useState<string | null>(null);
  const [recenter, setRecenter] = useState(0);
  const sources = useQuery({ queryKey: ["sources"], queryFn: knowledgeApi.list });
  const team = useQuery({ queryKey: ["team"], queryFn: agentsApi.team, enabled: mode === "agents" });
  const catalog = useQuery({ queryKey: ["catalog"], queryFn: agentsApi.catalog, enabled: mode === "agents" });
  // Quem está trabalhando: a mesma atividade da lista operacional (atualiza sozinha).
  const activity = useTeamActivity();
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
    const now = new Map((activity.data?.agents ?? []).map((a) => [a.id, MAP_STATE[a.status]]));
    return agentsMap(
      catalog.data.areas.map((a) => ({ id: a.id, title: a.title })),
      team.data.agents.map((a) => ({ id: a.id, name: a.name, title: a.title, area: a.area, reportsTo: a.reports_to, activity: now.get(a.id) ?? "idle" })),
      core,
    );
  }, [mode, sources.data, team.data, catalog.data, activity.data, core]);

  const error = mode === "knowledge" ? sources.error : (team.error ?? catalog.error);
  const reset = () => {
    setFocus(null);
    setSelected(null);
    setRecenter((n) => n + 1);
  };
  const choose = (node: MapNode) => {
    if (node.kind === "core") {
      reset();
      return onCore?.();
    }
    setFocus(node.id);
    setSelected(node);
  };
  // "Ir para…": áreas e, dentro de cada uma, seus itens (também é o caminho pelo teclado).
  const groups = useMemo(() => {
    if (!graph) return [];
    const areaOf = new Map(graph.edges.filter((e) => e.from.startsWith("area:")).map((e) => [e.to, e.from]));
    return graph.nodes.filter((n) => n.kind === "area").map((a) => ({ area: a, items: graph.nodes.filter((n) => areaOf.get(n.id) === a.id) }));
  }, [graph]);
  const counts = graph ? graph.nodes.filter((n) => n.kind === (mode === "knowledge" ? "source" : "agent")).length : 0;
  return (
    <section
      className={cn("relative flex flex-col overflow-hidden text-stone-100", variant === "card" ? "rounded-xl border border-white/10" : "size-full")}
      // Fundo das referências: quase preto e quente, com um brilho âmbar vindo do canto.
      style={{
        background: "radial-gradient(45% 40% at 6% 14%, rgba(234,88,12,0.30), transparent 70%), radial-gradient(70% 60% at 55% 55%, #16130f 0%, #0b0a09 72%)",
      }}
    >
      <div className={cn("flex flex-wrap items-center gap-2 border-b border-white/10 p-3", bare && "hidden")}>
        <NativeSelect
          aria-label="Ir para"
          className="max-w-56"
          size="sm"
          selectClassName="border-white/15 bg-black/60 text-stone-100 dark:bg-black/60"
          value={focus ?? ""}
          onChange={(e) => {
            const node = graph?.nodes.find((n) => n.id === e.target.value);
            if (node) choose(node);
            else reset();
          }}
        >
          <option value="">Ir para…</option>
          {groups.map((g) => (
            <optgroup key={g.area.id} label={g.area.label}>
              <option value={g.area.id}>{g.area.label} (área)</option>
              {g.items.map((n) => (
                <option key={n.id} value={n.id}>
                  {n.label}
                </option>
              ))}
            </optgroup>
          ))}
        </NativeSelect>
        <Button size="sm" variant="ghost" className="text-stone-200 hover:bg-white/10 hover:text-white" onClick={reset}>
          Recentrar
        </Button>
        {toolbar}
        <p className="hidden text-xs text-stone-400 md:block">Arraste para girar, role para aproximar e clique num {mode === "knowledge" ? "documento" : "agente"}.</p>
        <ul className="ml-auto flex flex-wrap gap-3 text-xs text-stone-300">
          {LEGEND[mode].map((l) => (
            <li key={l.label} className="inline-flex items-center gap-1">
              <span className="size-2 rounded-full" style={{ background: l.color }} /> {l.label}
            </li>
          ))}
        </ul>
      </div>
      <div className={cn("relative", variant === "card" ? "h-[460px] sm:h-[560px]" : "min-h-0 flex-1")}>
        <div className="absolute inset-y-0 transition-[left,right] duration-300" style={{ left: sceneInset?.left ?? 0, right: sceneInset?.right ?? 0 }}>
          {error ? (
            <div className="p-4">
              <ErrorNotice error={error} />
            </div>
          ) : !supported ? (
            <p className="p-6 text-sm text-stone-300">Este navegador não tem WebGL, então o mapa 3D não abre. A lista continua disponível na aba ao lado.</p>
          ) : !graph ? (
            <div className="p-4">
              <LoadingRows rows={3} />
            </div>
          ) : counts === 0 ? (
            <p className="p-6 text-sm text-stone-300">{mode === "knowledge" ? "O Cérebro ainda não tem documentos." : "O time ainda não tem agentes. Contrate em Agentes."}</p>
          ) : (
            <Suspense fallback={<p className="p-6 text-sm text-stone-300">Abrindo o mapa…</p>}>
              <BrainScene nodes={graph.nodes} edges={graph.edges} selected={selected?.id ?? null} focus={focus} recenter={recenter} onSelect={choose} reactor={reactor} />
            </Suspense>
          )}
        </div>
        {children}
        {selected?.kind === "agent" && (
          // Cartão de vidro como o do organograma das referências: ícone de onda, nome e cargo.
          <div className="absolute bottom-3 left-3 right-3 flex items-center gap-3 rounded-2xl border border-white/10 bg-white/[0.05] p-3 text-sm shadow-2xl backdrop-blur-md sm:right-auto sm:min-w-72">
            <Wave state={selected.state} />
            <div className="min-w-0 flex-1">
              <p className="truncate font-semibold text-[#f4ecd8]">{selected.label}</p>
              <p className="truncate text-xs text-stone-400">{selected.sublabel}</p>
              <p className="mt-0.5 text-[11px] text-stone-400">{AGENT_STATE_LABEL[selected.state] ?? ""}</p>
            </div>
            <div className="flex flex-col gap-1">
              <Button size="sm" disabled={station.isPending} onClick={() => station.mutate(selected.ref!)}>
                Conversar
              </Button>
              <Button size="sm" variant="ghost" className="text-stone-300 hover:bg-white/10 hover:text-white" onClick={reset}>
                Fechar
              </Button>
            </div>
          </div>
        )}
      </div>
      <p className={cn("border-t border-white/10 px-3 py-2 text-xs text-stone-300", bare && "hidden")}>
        {mode === "knowledge"
          ? `${counts} documento(s) em ${graph?.nodes.filter((n) => n.kind === "area").length ?? 0} área(s)`
          : `${counts} agente(s) no time · ${graph?.nodes.filter((n) => n.kind === "agent" && n.state === "running").length ?? 0} trabalhando agora`}
      </p>
      {selected?.kind === "source" && sources.data && <SourceDialog id={selected.ref!} areas={sources.data.areas} onClose={() => setSelected(null)} />}
    </section>
  );
}

const AGENT_STATE_LABEL: Partial<Record<MapNode["state"], string>> = {
  idle: "Disponível",
  running: "Trabalhando agora",
  waiting: "Aguardando você",
  done: "Concluiu hoje",
};

/** Ícone de onda em degradê turquesa → violeta (o "sinal" do agente); trabalhando, pulsa. */
function Wave({ state }: { state: MapNode["state"] }) {
  const active = state === "running" || state === "waiting";
  return (
    <div aria-hidden className="flex size-12 shrink-0 items-center justify-center rounded-xl border border-white/10 bg-black/40">
      <svg viewBox="0 0 40 20" className={cn("h-5 w-9", active && "motion-safe:animate-pulse")}>
        <defs>
          <linearGradient id="aurora-wave" x1="0" x2="1">
            <stop offset="0" stopColor="#2dd4bf" />
            <stop offset="1" stopColor="#818cf8" />
          </linearGradient>
        </defs>
        <path d="M1 11 C6 11 7 4 11 4 S16 17 20 17 S25 2 29 2 S34 11 39 11" fill="none" stroke="url(#aurora-wave)" strokeWidth="2.2" strokeLinecap="round" />
      </svg>
    </div>
  );
}
