/**
 * Organograma em cartões (como o "Fluxo de delegação" da v1): Chief of Staff na ponta e as
 * ramificações até cada agente, seguindo a quem cada um responde. Na horizontal ou na vertical;
 * cada cartão mostra o que o agente está fazendo agora. Clicar abre a Estação do agente.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowDownToLine, ArrowRightToLine, Sparkles } from "lucide-react";
import { useNavigate } from "react-router";
import { EmptyState, ErrorNotice, LoadingRows, Segmented } from "@/components/common";
import { agentsApi, type ActivityStatus, type OrgNode } from "@/lib/api";
import { cn } from "@/lib/utils";
import { ACTIVITY_STATUS, StatusDot, useTeamActivity } from "./activity";
import { useOpenStation } from "./agent-bits";
import { CARD, layoutTree, type Orientation, type TreeNode } from "./org-layout";

const KEY = "aurora:organograma";
const saved = (): Orientation => {
  try {
    return localStorage.getItem(KEY) === "vertical" ? "vertical" : "horizontal";
  } catch {
    return "horizontal";
  }
};

interface CardData {
  id: string;
  kind: string;
  name: string;
  title: string;
  status: ActivityStatus;
  activity: string;
  chief?: boolean;
}

export function OrgChart() {
  const [orientation, setOrientation] = useState<Orientation>(saved);
  const org = useQuery({ queryKey: ["organogram"], queryFn: agentsApi.organogram });
  const activity = useTeamActivity();
  const station = useOpenStation();
  const navigate = useNavigate();
  const board = useRef<HTMLDivElement>(null);

  const view = useMemo(() => {
    if (!org.data) return null;
    const areaTitle = (id: string) => org.data.areas.find((a) => a.id === id)?.title ?? id;
    const now = new Map((activity.data?.agents ?? []).map((a) => [a.id, a]));
    const cards = new Map<string, CardData>();
    const chief = activity.data?.chief;
    cards.set("chief", { id: "chief", kind: "Coordenação", name: org.data.chief.name, title: org.data.chief.title, status: chief?.status ?? "idle", activity: chief?.activity ?? "", chief: true });
    const toTree = (n: OrgNode): TreeNode => {
      const x = now.get(n.id);
      cards.set(n.id, {
        id: n.id,
        kind: n.reports.length ? `Lidera · ${areaTitle(n.area)}` : areaTitle(n.area),
        name: n.name,
        title: n.title,
        status: x?.status ?? "idle",
        activity: x?.activity ?? "",
      });
      return { id: n.id, children: n.reports.map(toTree) };
    };
    const root: TreeNode = { id: "chief", children: org.data.chief.reports.map(toTree) };
    const count = cards.size - 1;
    const leaders = [...cards.values()].filter((c) => c.kind.startsWith("Lidera")).length;
    return { layout: layoutTree(root, orientation), cards, count, leaders };
  }, [org.data, activity.data, orientation]);

  // Abre centrado no Chief of Staff (a árvore pode ser mais larga que a tela).
  const rootX = view?.layout.nodes.find((n) => n.id === "chief")?.x;
  const rootY = view?.layout.nodes.find((n) => n.id === "chief")?.y;
  useEffect(() => {
    const el = board.current;
    if (!el || rootX === undefined || rootY === undefined) return;
    el.scrollLeft = Math.max(0, rootX + CARD.w / 2 + 24 - el.clientWidth / 2);
    el.scrollTop = Math.max(0, rootY + CARD.h / 2 + 24 - el.clientHeight / 2);
  }, [rootX, rootY, orientation]);

  const orient = (o: Orientation) => {
    setOrientation(o);
    try {
      localStorage.setItem(KEY, o);
    } catch {
      /* sem armazenamento: vale só nesta visita */
    }
  };

  if (org.error) return <ErrorNotice error={org.error} />;
  if (!view) return <LoadingRows />;
  return (
    <section className="overflow-hidden rounded-xl border bg-card">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b p-3">
        <div>
          <h2 className="font-medium">Organograma</h2>
          <p className="text-xs text-muted-foreground">Do Chief of Staff até cada agente, seguindo a quem cada um responde.</p>
        </div>
        <Segmented
          label="Direção do organograma"
          value={orientation}
          onChange={orient}
          options={[
            [
              "horizontal",
              <span key="h" className="inline-flex items-center gap-1">
                <ArrowRightToLine className="size-3.5" /> Horizontal
              </span>,
            ],
            [
              "vertical",
              <span key="v" className="inline-flex items-center gap-1">
                <ArrowDownToLine className="size-3.5" /> Vertical
              </span>,
            ],
          ]}
        />
      </div>
      {view.count === 0 ? (
        <div className="p-6">
          <EmptyState title="Nenhum agente no time">Contrate especialistas no catálogo para o Chief of Staff escalar.</EmptyState>
        </div>
      ) : (
        <div
          ref={board}
          className="max-h-[70vh] overflow-auto p-6"
          // Fundo pontilhado, como a prancheta da v1.
          style={{ backgroundImage: "radial-gradient(circle, color-mix(in oklab, currentColor 14%, transparent) 1px, transparent 1px)", backgroundSize: "18px 18px" }}
        >
          <div className="relative mx-auto" style={{ width: view.layout.width, height: view.layout.height }}>
            <svg className="absolute inset-0 overflow-visible text-teal-500/60" width={view.layout.width} height={view.layout.height} aria-hidden>
              <defs>
                <marker id="org-arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
                  <path d="M0 0L8 4L0 8z" fill="currentColor" />
                </marker>
              </defs>
              {view.layout.edges.map((e) => {
                const lit = view.cards.get(e.to)!.status !== "idle";
                return (
                  <path
                    key={`${e.from}>${e.to}`}
                    d={e.d}
                    fill="none"
                    stroke="currentColor"
                    strokeWidth={lit ? 2 : 1.4}
                    className={cn(lit && "text-orange-400")}
                    markerEnd="url(#org-arrow)"
                  />
                );
              })}
            </svg>
            <ol aria-label="Cartões do organograma">
              {view.layout.nodes.map((p) => {
                const c = view.cards.get(p.id)!;
                const s = ACTIVITY_STATUS[c.status];
                return (
                  <li key={p.id} className="absolute" style={{ left: p.x, top: p.y, width: CARD.w, height: CARD.h }}>
                    <button
                      type="button"
                      onClick={() => (c.chief ? void navigate("/jarvis") : station.mutate(c.id))}
                      disabled={station.isPending}
                      aria-label={c.chief ? "Conversar com o Chief of Staff" : `Abrir a Estação de ${c.name}`}
                      className={cn(
                        "flex size-full flex-col justify-center rounded-xl border bg-background/90 px-3 text-left shadow-sm transition-colors hover:border-teal-500/60",
                        c.chief && "border-amber-500/60",
                        c.status !== "idle" && !c.chief && "border-orange-400/60",
                      )}
                    >
                      <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
                        {c.chief ? <Sparkles className="size-3 text-amber-500" /> : <span aria-hidden>◇</span>}
                        <span className="truncate">{c.kind}</span>
                      </span>
                      <span className={cn("truncate font-semibold", c.chief && "text-base")}>{c.name}</span>
                      <span className="flex items-center gap-1.5 text-[11px]">
                        <StatusDot status={c.status} />
                        <span className="truncate" style={{ color: c.status === "idle" ? undefined : s.color }} title={c.activity}>
                          {c.status === "idle" ? c.title : s.label}
                        </span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ol>
          </div>
        </div>
      )}
      <p className="border-t px-3 py-2 text-xs text-muted-foreground">
        {view.count} agente(s) · {view.leaders} com equipe própria · {[...view.cards.values()].filter((c) => !c.chief && c.status !== "idle").length} em trabalho agora
      </p>
    </section>
  );
}
