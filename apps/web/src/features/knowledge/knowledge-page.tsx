/**
 * Cérebro: as fontes da empresa e perguntas respondidas só com elas. Cada resposta cita a fonte e
 * a versão, com link para o arquivo original; sem evidência, o Cérebro se abstém.
 */
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BrainCircuit, ExternalLink, FileText, Search } from "lucide-react";
import { EmptyState, ErrorNotice, LoadingRows, PageHeader, ToneBadge } from "@/components/common";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { knowledgeApi } from "@/lib/api";
import { formatDate, relativeTime, SOURCE_STATUS } from "@/lib/format";
import { SourceDialog } from "./source-dialog";
import { UploadDialog } from "./upload-dialog";

export function KnowledgePage() {
  const sources = useQuery({ queryKey: ["sources"], queryFn: knowledgeApi.list });
  const [open, setOpen] = useState<string | null>(null);
  return (
    <div className="space-y-6">
      <PageHeader
        title="Cérebro"
        description="Documentos da empresa com dono, acesso, versões e vigência. Os agentes só leem o que está aberto a toda a empresa."
        actions={<UploadDialog sources={sources.data?.sources ?? []} mediaTypes={sources.data?.media_types ?? []} />}
      />
      <Ask />
      <ErrorNotice error={sources.error} title="Não foi possível carregar as fontes" />
      {sources.isPending ? (
        <LoadingRows />
      ) : !sources.data?.sources.length ? (
        <EmptyState icon={<BrainCircuit />} title="O Cérebro está vazio">
          Envie políticas, procedimentos e dados (texto, Markdown, CSV ou JSON). Eu leio, divido em trechos e cito nas respostas.
        </EmptyState>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {sources.data.sources.map((s) => (
            <li key={s.id}>
              <button type="button" onClick={() => setOpen(s.id)} className="flex h-full w-full flex-col gap-2 rounded-xl border bg-card p-4 text-left transition-colors hover:bg-muted/50">
                <div className="flex items-start justify-between gap-2">
                  <FileText className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                  <ToneBadge tone={SOURCE_STATUS[s.status].tone}>{SOURCE_STATUS[s.status].label}</ToneBadge>
                </div>
                <p className="line-clamp-2 font-medium">{s.title}</p>
                <p className="mt-auto text-xs text-muted-foreground">
                  v{s.current_version ?? s.latest_version} · {s.readers.includes("*") ? "toda a empresa" : `${s.readers.length} leitor(es)`} · {relativeTime(s.created_at)}
                </p>
              </button>
            </li>
          ))}
        </ul>
      )}
      {open && <SourceDialog id={open} onClose={() => setOpen(null)} />}
    </div>
  );
}

function Ask() {
  const [question, setQuestion] = useState("");
  const queryClient = useQueryClient();
  const ask = useMutation({ mutationFn: (q: string) => knowledgeApi.ask(q), onSettled: () => void queryClient.invalidateQueries({ queryKey: ["sources"] }) });
  const answer = ask.data;
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Perguntar ao Cérebro</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (question.trim()) ask.mutate(question.trim());
          }}
        >
          <Input value={question} maxLength={1000} placeholder="Ex.: Quem aprova compras acima de dez mil reais?" onChange={(e) => setQuestion(e.target.value)} />
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
                        [{c.n}] {c.title} <span className="text-xs font-normal text-muted-foreground">v{c.version} · desde {formatDate(c.valid_from)}</span>
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
