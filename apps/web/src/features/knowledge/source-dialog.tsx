/** Detalhe de uma fonte: versões (com o original de cada uma), nova versão e revogação. */
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Ban, ExternalLink, FilePlus } from "lucide-react";
import { ErrorNotice, LoadingRows, ToneBadge } from "@/components/common";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { fileToBase64, knowledgeApi } from "@/lib/api";
import { formatBytes, formatDate, formatDateTime, SOURCE_STATUS } from "@/lib/format";
import { mediaTypeOf } from "./upload-dialog";
import { useAgentNames } from "../agents/agent-bits";

export function SourceDialog({ id, onClose }: { id: string; onClose: () => void }) {
  const agentName = useAgentNames();
  const queryClient = useQueryClient();
  const source = useQuery({ queryKey: ["source", id], queryFn: () => knowledgeApi.get(id) });
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ["source", id] });
    void queryClient.invalidateQueries({ queryKey: ["sources"] });
  };
  const [file, setFile] = useState<File | null>(null);
  const [validFrom, setValidFrom] = useState("");
  const [confirmRevoke, setConfirmRevoke] = useState(false);
  const addVersion = useMutation({
    mutationFn: async () =>
      knowledgeApi.addVersion(id, {
        filename: file!.name,
        media_type: mediaTypeOf(file!),
        content_base64: await fileToBase64(file!),
        valid_from: validFrom ? new Date(`${validFrom}T00:00:00`).toISOString() : undefined,
      }),
    onSuccess: () => {
      setFile(null);
      setValidFrom("");
      refresh();
    },
  });
  const revoke = useMutation({ mutationFn: () => knowledgeApi.revoke(id), onSuccess: refresh });
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
            <section className="space-y-2">
              <h3 className="text-sm font-medium">Versões</h3>
              <ul className="divide-y rounded-lg border text-sm">
                {s.versions.map((v) => (
                  <li key={v.version} className="flex flex-wrap items-center gap-x-3 gap-y-1 p-3">
                    <span className="font-medium">v{v.version}</span>
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
                    if (file) addVersion.mutate();
                  }}
                >
                  <h3 className="text-sm font-medium">Nova versão</h3>
                  <div className="grid gap-3 sm:grid-cols-[1fr_180px]">
                    <Input type="file" aria-label="Arquivo da nova versão" accept=".txt,.md,.markdown,.csv,.json" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
                    <div className="space-y-1">
                      <Label htmlFor="v-valid" className="text-xs">
                        Vale a partir de
                      </Label>
                      <Input id="v-valid" type="date" value={validFrom} onChange={(e) => setValidFrom(e.target.value)} />
                    </div>
                  </div>
                  <ErrorNotice error={addVersion.error} title="Versão não publicada" />
                  <Button type="submit" size="sm" disabled={!file || addVersion.isPending}>
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
