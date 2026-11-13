/**
 * Cérebro: as fontes da empresa, organizadas por área, e perguntas respondidas só com elas. Cada
 * resposta cita a fonte, a versão e a seção, com link para o original; sem evidência, abstém-se.
 */
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BrainCircuit, ExternalLink, FileText, PenLine, Search } from "lucide-react";
import { EmptyState, ErrorNotice, LoadingRows, PageHeader, Segmented, ToneBadge } from "@/components/common";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { knowledgeApi, type BrainArea, type SemanticStatus, type SourceSummary } from "@/lib/api";
import { formatDate, relativeTime, SOURCE_STATUS } from "@/lib/format";
import { cn } from "@/lib/utils";
import { useSearchParams } from "react-router";
import { BrainMap } from "../brain-map/brain-map";
import { AreasDialog } from "./areas-dialog";
import { SourceDialog } from "./source-dialog";
import { UploadDialog } from "./upload-dialog";

const ALL = "";

export function KnowledgePage() {
  // Enquanto a busca por significado se prepara, atualiza o progresso.
  const sources = useQuery({
    queryKey: ["sources"],
    queryFn: knowledgeApi.list,
    refetchInterval: (q) => {
      const s = q.state.data?.semantic;
      return s && !s.error && s.indexed < s.total ? 3000 : false;
    },
  });
  const [open, setOpen] = useState<string | null>(null);
  const [area, setArea] = useState(ALL);
  // `?vista=mapa` abre o mapa 3D do acervo (a rede de agentes fica em Agentes e no Jarvis).
  const [params, setParams] = useSearchParams();
  const map = params.get("vista") === "mapa";
  const data = sources.data;
  const areas = data?.areas ?? [];
  const shown = useMemo(() => (data?.sources ?? []).filter((s) => area === ALL || s.area === area), [data, area]);
  const areaTitle = (id: string) => areas.find((a) => a.id === id)?.title ?? id;
  return (
    <div className="space-y-6">
      <PageHeader
        title="Cérebro"
        description="Documentos da empresa por área, com dono, acesso, versões e vigência. Os agentes leem o que está aberto a todos e o que foi liberado para eles."
        actions={
          <>
            <Segmented
              label="Como ver"
              value={map}
              options={[
                [false, "Lista"],
                [true, "Mapa 3D"],
              ]}
              onChange={(m) => setParams(m ? { vista: "mapa" } : {})}
            />
            <AreasDialog areas={areas} />
            <UploadDialog sources={data?.sources ?? []} areas={areas} formats={data?.formats ?? []} defaultArea={area || undefined} />
          </>
        }
      />
      {map && <BrainMap mode="knowledge" />}
      <Ask areas={areas} area={area} />
      <ErrorNotice error={sources.error} title="Não foi possível carregar as fontes" />
      {sources.isPending ? (
        <LoadingRows />
      ) : !data?.sources.length ? (
        <EmptyState icon={<BrainCircuit />} title="O Cérebro está vazio">
          Envie políticas, contratos, tabelas e manuais (PDF, Word, TXT, Markdown, CSV ou JSON) ou escreva um texto. Eu leio, divido em trechos e cito nas respostas.
        </EmptyState>
      ) : (
        <>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <AreaFilter areas={areas} total={data.sources.filter((s) => !s.revoked_at).length} value={area} onChange={setArea} />
            <SemanticBadge status={data.semantic} />
          </div>
          {shown.length ? (
            <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {shown.map((s) => (
                <li key={s.id}>
                  <SourceCard source={s} areaTitle={areaTitle(s.area)} onOpen={() => setOpen(s.id)} />
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">Nenhuma fonte nesta área ainda.</p>
          )}
        </>
      )}
      {open && <SourceDialog id={open} areas={areas} onClose={() => setOpen(null)} />}
    </div>
  );
}

/** Mostra se a busca por significado está pronta, preparando ou indisponível. */
function SemanticBadge({ status }: { status: SemanticStatus | null }) {
  if (!status) return <span className="text-xs text-muted-foreground">Busca por palavras</span>;
  if (status.error)
    return (
      <span className="text-xs text-amber-700 dark:text-warning" title={status.error}>
        Busca por significado indisponível (só palavras)
      </span>
    );
  if (status.indexed < status.total)
    return (
      <span className="text-xs text-muted-foreground">
        Preparando busca por significado: {status.indexed}/{status.total} trechos
      </span>
    );
  return <span className="text-xs text-muted-foreground">Busca por palavras e por significado · {status.total} trechos</span>;
}

function AreaFilter({ areas, total, value, onChange }: { areas: BrainArea[]; total: number; value: string; onChange: (area: string) => void }) {
  const chips = [{ id: ALL, title: "Todas", sources: total }, ...areas.filter((a) => a.sources > 0 || a.id === value)];
  return (
    <div className="flex flex-wrap gap-2" role="tablist" aria-label="Áreas do Cérebro">
      {chips.map((a) => (
        <button
          key={a.id || "all"}
          type="button"
          role="tab"
          aria-selected={value === a.id}
          onClick={() => onChange(a.id)}
          className={cn(
            "rounded-full border px-3 py-1 text-xs transition-colors",
            value === a.id ? "border-primary bg-primary text-primary-foreground" : "hover:bg-muted",
          )}
        >
          {a.title} <span className="opacity-70">{a.sources}</span>
        </button>
      ))}
    </div>
  );
}

function SourceCard({ source: s, areaTitle, onOpen }: { source: SourceSummary; areaTitle: string; onOpen: () => void }) {
  const written = s.format?.origin === "text";
  return (
    <button type="button" onClick={onOpen} className="flex h-full w-full flex-col gap-2 rounded-xl border bg-card p-4 text-left transition-colors hover:bg-muted/50">
      <div className="flex items-start justify-between gap-2">
        <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
          {written ? <PenLine className="size-4" /> : <FileText className="size-4" />}
          {written ? "Texto" : s.format && <span className="rounded border px-1.5 py-0.5 font-mono text-[10px] uppercase">{s.format.label}</span>}
        </span>
        <ToneBadge tone={SOURCE_STATUS[s.status].tone}>{SOURCE_STATUS[s.status].label}</ToneBadge>
      </div>
      <p className="line-clamp-2 font-medium">{s.title}</p>
      <p className="mt-auto text-xs text-muted-foreground">
        {areaTitle} · v{s.current_version ?? s.latest_version} · {s.readers.includes("*") ? "toda a empresa" : `${s.readers.length} leitor(es)`} · {relativeTime(s.created_at)}
      </p>
    </button>
  );
}

function Ask({ areas, area: initial }: { areas: BrainArea[]; area: string }) {
  const [question, setQuestion] = useState("");
  const [area, setArea] = useState(initial);
  const queryClient = useQueryClient();
  const ask = useMutation({
    mutationFn: (q: string) => knowledgeApi.ask(q, area || undefined),
    onSettled: () => void queryClient.invalidateQueries({ queryKey: ["sources"] }),
  });
  const answer = ask.data;
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Perguntar ao Cérebro</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <form
          className="flex flex-col gap-2 sm:flex-row"
          onSubmit={(e) => {
            e.preventDefault();
            if (question.trim()) ask.mutate(question.trim());
          }}
        >
          <Input value={question} maxLength={1000} placeholder="Ex.: Quem aprova compras acima de dez mil reais?" onChange={(e) => setQuestion(e.target.value)} className="sm:flex-1" />
          <NativeSelect aria-label="Procurar em" value={area} onChange={(e) => setArea(e.target.value)}>
            <option value={ALL}>Todas as áreas</option>
            {areas.map((a) => (
              <option key={a.id} value={a.id}>
                {a.title}
              </option>
            ))}
          </NativeSelect>
          <Button type="submit" disabled={!question.trim() || ask.isPending}>
            <Search /> {ask.isPending ? "Buscando…" : "Perguntar"}
          </Button>
        </form>
        <ErrorNotice error={ask.error} />
        {answer && (
          <div className="space-y-3">
            {answer.abstained && <ToneBadge tone="warning">Sem evidência suficiente</ToneBadge>}
            <p className="whitespace-pre-wrap text-sm leading-relaxed">{answer.answer}</p>
            {answer.citations.length > 0 && (
              <ol className="space-y-2">
                {answer.citations.map((c) => (
                  <li key={c.n} className="rounded-lg border p-3 text-sm">
                    <div className="flex items-start justify-between gap-2">
                      <p className="font-medium">
                        [{c.n}] {c.title}
                        {c.section && <span className="font-normal"> › {c.section}</span>}{" "}
                        <span className="text-xs font-normal text-muted-foreground">v{c.version} · desde {formatDate(c.valid_from)}</span>
                      </p>
                      <a href={c.url} target="_blank" rel="noreferrer" className="inline-flex shrink-0 items-center gap-1 text-xs text-sky-600 hover:underline dark:text-sky-400">
                        Original <ExternalLink className="size-3" />
                      </a>
                    </div>
                    <p className="mt-1 line-clamp-3 text-xs text-muted-foreground">{c.excerpt}</p>
                  </li>
                ))}
              </ol>
            )}
            <p className="text-[11px] text-muted-foreground">
              Resposta {answer.decision.engine === "model" ? `redigida pelo modelo (${answer.decision.provider})` : "extraída dos trechos"}
              {answer.decision.fallback && ` · modelo indisponível: ${answer.decision.fallback}`}
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
