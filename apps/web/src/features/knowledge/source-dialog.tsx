/** Detalhe de uma fonte: área, versões (com o original e o formato de cada uma), nova versão (arquivo ou texto) e revogação. */
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Ban, ExternalLink, FilePlus } from "lucide-react";
import { ErrorNotice, LoadingRows, ToneBadge } from "@/components/common";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { fileToBase64, knowledgeApi, type BrainArea } from "@/lib/api";
import { formatBytes, formatDate, formatDateTime, SOURCE_STATUS } from "@/lib/format";
import { acceptOf, mediaTypeOf } from "./upload-dialog";
import { useAgentNames } from "../agents/agent-bits";

export function SourceDialog({ id, areas, onClose }: { id: string; areas: BrainArea[]; onClose: () => void }) {
  const agentName = useAgentNames();
  const queryClient = useQueryClient();
  const source = useQuery({ queryKey: ["source", id], queryFn: () => knowledgeApi.get(id) });
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ["source", id] });
    void queryClient.invalidateQueries({ queryKey: ["sources"] });
  };
  const [file, setFile] = useState<File | null>(null);
  const [text, setText] = useState("");
  const [asText, setAsText] = useState(false);
  const [validFrom, setValidFrom] = useState("");
  const [confirmRevoke, setConfirmRevoke] = useState(false);
  const addVersion = useMutation({
    mutationFn: async () => {
      const valid_from = validFrom ? new Date(`${validFrom}T00:00:00`).toISOString() : undefined;
      if (asText) return knowledgeApi.addVersion(id, { text, valid_from });
      return knowledgeApi.addVersion(id, { filename: file!.name, media_type: mediaTypeOf(file!), content_base64: await fileToBase64(file!), valid_from });
    },
    onSuccess: () => {
      setFile(null);
      setText("");
      setValidFrom("");
      refresh();
    },
  });
  const revoke = useMutation({ mutationFn: () => knowledgeApi.revoke(id), onSuccess: refresh });
  const move = useMutation({ mutationFn: (area: string) => knowledgeApi.move(id, area), onSuccess: refresh });
  const s = source.data;

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl">
        {!s ? (
          source.error ? <ErrorNotice error={source.error} /> : <LoadingRows rows={2} />
        ) : (
          <>
            <DialogHeader>
              <DialogTitle className="flex flex-wrap items-center gap-2">
                {s.title} <ToneBadge tone={SOURCE_STATUS[s.status].tone}>{SOURCE_STATUS[s.status].label}</ToneBadge>
              </DialogTitle>
              <DialogDescription>
                Dono: {s.owner} · Leitura: {s.readers.includes("*") ? "toda a empresa" : s.readers.map((r) => (r.startsWith("agent:") ? `${agentName(r.slice(6))} (agente)` : r)).join(", ")}
                {s.current_version && ` · responde com a v${s.current_version}`}
              </DialogDescription>
            </DialogHeader>
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <label htmlFor="s-area" className="text-muted-foreground">
                Área
              </label>
              <select
                id="s-area"
                className="h-8 rounded-md border bg-transparent px-2 text-sm"
                value={s.area}
                disabled={move.isPending || s.status === "revoked"}
                onChange={(e) => move.mutate(e.target.value)}
              >
                {areas.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.title}
                  </option>
                ))}
              </select>
              <ErrorNotice error={move.error} />
            </div>
            {s.format?.media_type.startsWith("image/") && s.versions[0] && (
              <a href={s.versions[0].url} target="_blank" rel="noreferrer" className="block overflow-hidden rounded-lg border">
                <img src={s.versions[0].url} alt={s.title} className="max-h-64 w-full bg-muted object-contain" />
              </a>
            )}
            <section className="space-y-2">
              <h3 className="text-sm font-medium">Versões</h3>
              <ul className="divide-y rounded-lg border text-sm">
                {s.versions.map((v) => (
                  <li key={v.version} className="flex flex-wrap items-center gap-x-3 gap-y-1 p-3">
                    <span className="font-medium">v{v.version}</span>
                    <span className="rounded border px-1.5 py-0.5 font-mono text-[10px] uppercase text-muted-foreground">{v.origin === "text" ? "texto" : v.format}</span>
                    <span className="min-w-0 flex-1 truncate text-muted-foreground">{v.filename}</span>
                    <span className="text-xs text-muted-foreground">
                      {formatBytes(v.size_bytes)} · vale desde {formatDate(v.valid_from)} · enviada {formatDateTime(v.created_at)}
                    </span>
                    <a href={v.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs text-sky-600 hover:underline dark:text-sky-400">
                      Original <ExternalLink className="size-3" />
                    </a>
                  </li>
                ))}
              </ul>
            </section>
            {s.status !== "revoked" && (
              <>
                <form
                  className="space-y-3 rounded-lg border p-3"
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (asText ? text.trim() : file) addVersion.mutate();
                  }}
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h3 className="text-sm font-medium">Nova versão</h3>
                    <label className="flex items-center gap-2 text-xs text-muted-foreground">
                      <input type="checkbox" checked={asText} onChange={(e) => setAsText(e.target.checked)} /> Escrever o texto em vez de enviar arquivo
                    </label>
                  </div>
                  {asText && <Textarea aria-label="Texto da nova versão" rows={6} value={text} onChange={(e) => setText(e.target.value)} />}
                  <div className="grid gap-3 sm:grid-cols-[1fr_180px]">
                    {asText ? (
                      <span />
                    ) : (
                      <Input type="file" aria-label="Arquivo da nova versão" accept={acceptOf([])} onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
                    )}
                    <div className="space-y-1">
                      <Label htmlFor="v-valid" className="text-xs">
                        Vale a partir de
                      </Label>
                      <Input id="v-valid" type="date" value={validFrom} onChange={(e) => setValidFrom(e.target.value)} />
                    </div>
                  </div>
                  <ErrorNotice error={addVersion.error} title="Versão não publicada" />
                  <Button type="submit" size="sm" disabled={(asText ? !text.trim() : !file) || addVersion.isPending}>
                    <FilePlus /> Publicar versão
                  </Button>
                </form>
                <div className="flex flex-col gap-2 rounded-lg border border-destructive/40 p-3 sm:flex-row sm:items-center">
                  <p className="min-w-0 flex-1 text-sm">Revogar tira a fonte das respostas na hora. O histórico continua guardado e não dá para desfazer.</p>
                  {confirmRevoke ? (
                    <div className="flex gap-2">
                      <Button variant="ghost" size="sm" onClick={() => setConfirmRevoke(false)}>
                        Cancelar
                      </Button>
                      <Button variant="destructive" size="sm" disabled={revoke.isPending} onClick={() => revoke.mutate()}>
                        Confirmar revogação
                      </Button>
                    </div>
                  ) : (
                    <Button variant="outline" size="sm" onClick={() => setConfirmRevoke(true)}>
                      <Ban /> Revogar
                    </Button>
                  )}
                </div>
                <ErrorNotice error={revoke.error} />
              </>
            )}
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
