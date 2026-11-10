/**
 * Uma entrega: a versão escolhida (padrão: a atual), a decisão do gestor sobre a versão atual,
 * as versões anteriores, os ajustes pedidos e o histórico.
 */
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Check, Download, FolderOutput, RotateCcw } from "lucide-react";
import { Link, useParams } from "react-router";
import { ErrorNotice, LoadingRows, ToneBadge } from "@/components/common";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { deliverablesApi, integrationsApi, type DeliverableDetail } from "@/lib/api";
import { DELIVERABLE_STATUS, EVENT_LABEL, formatDateTime, shortId } from "@/lib/format";
import { cn } from "@/lib/utils";
import { ReportView } from "../jobs/report-view";

export function DeliverablePage() {
  const { id = "" } = useParams();
  const d = useQuery({
    queryKey: ["deliverable", id],
    queryFn: () => deliverablesApi.get(id),
    refetchInterval: (q) => (q.state.data?.status === "changes_requested" ? 3000 : false),
  });
  const [picked, setPicked] = useState<number | null>(null);
  if (d.isPending) return <LoadingRows rows={4} />;
  if (d.error) return <ErrorNotice error={d.error} title="Entrega não encontrada" />;
  const data = d.data;
  const version = picked ?? data.current_version;
  const shown = data.versions.find((v) => v.version === version) ?? data.versions[0]!;
  const status = DELIVERABLE_STATUS[data.status];
  return (
    <div className="space-y-6">
      <Link to="/entregas" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" /> Entregas
      </Link>
      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <ToneBadge tone={status.tone}>{status.label}</ToneBadge>
          <span className="text-xs text-muted-foreground">Versão atual {data.current_version}</span>
        </div>
        <h1 className="text-xl font-semibold leading-snug">{data.title}</h1>
      </div>

      <Decision data={data} />

      <div className="grid gap-6 lg:grid-cols-[1fr_300px]">
        <Card>
          <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
            <CardTitle>Versão {shown.version}</CardTitle>
            <div className="flex items-center gap-2">
              {data.versions.length > 1 && (
                <div className="flex gap-1" role="group" aria-label="Escolher versão">
                  {[...data.versions].reverse().map((v) => (
                    <button
                      key={v.version}
                      type="button"
                      onClick={() => setPicked(v.version)}
                      className={cn("rounded-md border px-2 py-0.5 text-xs", v.version === shown.version ? "border-transparent bg-primary text-primary-foreground" : "hover:bg-muted")}
                    >
                      v{v.version}
                    </button>
                  ))}
                </div>
              )}
              <Button asChild size="sm" variant="outline">
                <a href={deliverablesApi.markdownUrl(data.id, shown.version)}>
                  <Download /> Markdown
                </a>
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            <p className="mb-4 text-xs text-muted-foreground">
              Entregue {formatDateTime(shown.created_at)} pelo{" "}
              <Link to={`/trabalhos/${shown.job_id}`} className="underline">
                trabalho #{shortId(shown.job_id)}
              </Link>
            </p>
            <ReportView report={shown.content.report} />
          </CardContent>
        </Card>
        <div className="space-y-6">
          {data.reopenings.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>Ajustes pedidos</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                {data.reopenings.map((r) => (
                  <div key={r.job_id} className="rounded-lg border p-3">
                    <p className="text-xs text-muted-foreground">
                      Sobre a v{r.from_version} · {formatDateTime(r.created_at)} ·{" "}
                      <Link to={`/trabalhos/${r.job_id}`} className="underline">
                        trabalho #{shortId(r.job_id)}
                      </Link>
                    </p>
                    <p className="mt-1">{r.feedback}</p>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}
          <Card>
            <CardHeader>
              <CardTitle>Histórico</CardTitle>
            </CardHeader>
            <CardContent>
              <ol className="space-y-2 text-sm">
                {data.history.map((e) => (
                  <li key={e.seq} className="flex flex-col">
                    <span>
                      {EVENT_LABEL[e.kind] ?? e.kind}
                      {typeof e.detail.version === "number" && ` · v${e.detail.version}`}
                    </span>
                    <span className="text-xs text-muted-foreground">{formatDateTime(e.at)}</span>
                  </li>
                ))}
              </ol>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

/** Entrega aceita: pode sair da empresa por uma conexão com permissão de escrita. */
function AcceptedActions({ data }: { data: DeliverableDetail }) {
  const connections = useQuery({ queryKey: ["connections"], queryFn: integrationsApi.list });
  const writable = (connections.data?.connections ?? []).filter((c) => c.status === "active" && c.permissions.write);
  const [target, setTarget] = useState("");
  const save = useMutation({ mutationFn: () => integrationsApi.exportDeliverable(target || writable[0]!.id, data.id, data.current_version) });
  return (
    <div className="space-y-3 rounded-xl border bg-card p-4 text-sm">
      <p>
        Aceita por {data.decided_by} na versão {data.current_version}.
      </p>
      {writable.length > 0 ? (
        <div className="flex flex-wrap items-center gap-2">
          <select aria-label="Salvar em" className="h-9 rounded-md border bg-transparent px-2" value={target} onChange={(e) => setTarget(e.target.value)}>
            {writable.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
          <Button size="sm" variant="outline" disabled={save.isPending} onClick={() => save.mutate()}>
            <FolderOutput /> Salvar na pasta
          </Button>
          {save.data && <span className="text-xs text-success">Salva como “{save.data.file}”.</span>}
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">
          Para salvar esta entrega fora do Aurora,{" "}
          <Link to="/integracoes" className="underline">
            conecte uma pasta com permissão de escrita
          </Link>
          .
        </p>
      )}
      <ErrorNotice error={save.error} title="Não salvou" />
    </div>
  );
}

function Decision({ data }: { data: DeliverableDetail }) {
  const queryClient = useQueryClient();
  const [asking, setAsking] = useState(false);
  const [feedback, setFeedback] = useState("");
  const refresh = () => {
    for (const key of [["deliverable", data.id], ["deliverables"], ["jobs"]]) void queryClient.invalidateQueries({ queryKey: key });
  };
  const accept = useMutation({ mutationFn: () => deliverablesApi.accept(data.id, data.current_version), onSuccess: refresh });
  const changes = useMutation({
    mutationFn: () => deliverablesApi.requestChanges(data.id, data.current_version, feedback.trim()),
    onSuccess: () => {
      setAsking(false);
      setFeedback("");
      refresh();
    },
  });
  if (data.status === "accepted") return <AcceptedActions data={data} />;
  if (data.status === "changes_requested")
    return (
      <p className="rounded-xl border bg-card p-4 text-sm">
        O time está refazendo a partir do seu retorno: “{data.decision_note}”. A versão {data.current_version + 1} chega aqui para revisão quando o novo parecer for aprovado.
      </p>
    );
  return (
    <div className="space-y-3 rounded-xl border bg-card p-4">
      {!asking ? (
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <p className="min-w-0 flex-1 text-sm">Revise a versão {data.current_version}. Aceitar encerra a entrega; pedir ajustes reabre o trabalho com o seu retorno.</p>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => setAsking(true)}>
              <RotateCcw /> Pedir ajustes
            </Button>
            <Button disabled={accept.isPending} onClick={() => accept.mutate()}>
              <Check /> Aceitar
            </Button>
          </div>
        </div>
      ) : (
        <form
          className="space-y-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (feedback.trim().length >= 10) changes.mutate();
          }}
        >
          <label htmlFor="feedback" className="text-sm font-medium">
            O que precisa mudar?
          </label>
          <Textarea id="feedback" rows={3} maxLength={1000} value={feedback} onChange={(e) => setFeedback(e.target.value)} placeholder="Ex.: Inclua os prazos de pagamento a fornecedores." />
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => setAsking(false)}>
              Cancelar
            </Button>
            <Button type="submit" disabled={feedback.trim().length < 10 || changes.isPending}>
              Reabrir com este retorno
            </Button>
          </div>
        </form>
      )}
      <ErrorNotice error={accept.error ?? changes.error} />
    </div>
  );
}
