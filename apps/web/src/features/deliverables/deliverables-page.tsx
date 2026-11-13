/** Entregas: o que o time produziu e espera sua revisão, o que foi aceito e o que está em ajuste. */
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { PackageCheck } from "lucide-react";
import { Link } from "react-router";
import { EmptyState, ErrorNotice, LoadingRows, PageHeader, ToneBadge } from "@/components/common";
import { deliverablesApi, type DeliverableStatus } from "@/lib/api";
import { DELIVERABLE_STATUS, relativeTime } from "@/lib/format";
import { cn } from "@/lib/utils";

const FILTERS: { id: "all" | DeliverableStatus; label: string }[] = [
  { id: "all", label: "Todas" },
  { id: "in_review", label: "Para revisar" },
  { id: "changes_requested", label: "Em ajuste" },
  { id: "accepted", label: "Aceitas" },
];

export function DeliverablesPage() {
  const list = useQuery({ queryKey: ["deliverables"], queryFn: deliverablesApi.list, refetchInterval: 5000 });
  const [filter, setFilter] = useState<(typeof FILTERS)[number]["id"]>("all");
  const items = (list.data?.deliverables ?? []).filter((d) => filter === "all" || d.status === filter);
  return (
    <div className="space-y-6">
      <PageHeader title="Entregas" description="Artefatos dos trabalhos aprovados. Aceite a versão atual ou peça ajustes: o time refaz e entrega a próxima versão." />
      <div className="flex flex-wrap gap-2" role="group" aria-label="Filtrar entregas">
        {FILTERS.map((f) => (
          <button
            key={f.id}
            type="button"
            onClick={() => setFilter(f.id)}
            className={cn("rounded-full border px-3 py-1 text-xs", filter === f.id ? "border-transparent bg-primary text-primary-foreground" : "hover:bg-muted")}
          >
            {f.label}
          </button>
        ))}
      </div>
      <ErrorNotice error={list.error} title="Não foi possível carregar as entregas" />
      {list.isPending ? (
        <LoadingRows />
      ) : !items.length ? (
        <EmptyState icon={<PackageCheck />} title={filter === "all" ? "Nenhuma entrega ainda" : "Nada neste filtro"}>
          Quando você aprova o parecer de um trabalho, a entrega aparece aqui para revisão final.
        </EmptyState>
      ) : (
        <ul className="divide-y rounded-xl border">
          {items.map((d) => (
            <li key={d.id}>
              <Link to={`/entregas/${d.id}`} className="flex flex-col gap-2 p-4 hover:bg-muted/50 sm:flex-row sm:items-center">
                <div className="min-w-0 flex-1">
                  <p className="line-clamp-2 font-medium">{d.title}</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Versão {d.current_version} · atualizada {relativeTime(d.updated_at)}
                  </p>
                </div>
                <ToneBadge tone={DELIVERABLE_STATUS[d.status].tone}>{DELIVERABLE_STATUS[d.status].label}</ToneBadge>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
