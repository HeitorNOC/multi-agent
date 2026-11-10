/** Uma conexão: arquivos (se puder ler), permissões, desconectar/reconectar e a trilha. */
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Download } from "lucide-react";
import { ErrorNotice, LoadingRows } from "@/components/common";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { integrationsApi } from "@/lib/api";
import { EVENT_LABEL, formatBytes, formatDateTime } from "@/lib/format";

export function ConnectionDialog({ id, onClose }: { id: string; onClose: () => void }) {
  const queryClient = useQueryClient();
  const c = useQuery({ queryKey: ["connection", id], queryFn: () => integrationsApi.get(id) });
  const canRead = c.data?.status === "active" && c.data.permissions.read;
  const files = useQuery({ queryKey: ["connection-files", id], queryFn: () => integrationsApi.files(id), enabled: !!canRead, retry: false });
  const [imported, setImported] = useState<Record<string, string>>({});
  const refresh = () => {
    for (const key of [["connection", id], ["connections"], ["integrations-catalog"], ["connection-files", id]]) void queryClient.invalidateQueries({ queryKey: key });
  };
  const change = useMutation({ mutationFn: (input: Parameters<typeof integrationsApi.change>[1]) => integrationsApi.change(id, input), onSuccess: refresh });
  const importFile = useMutation({
    mutationFn: (file: string) => integrationsApi.importFile(id, file),
    onSuccess: (r, file) => {
      setImported((m) => ({ ...m, [file]: r.source.title }));
      void queryClient.invalidateQueries({ queryKey: ["sources"] });
      refresh();
    },
  });
  const data = c.data;
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl">
        {!data ? (
          <>
            <DialogHeader>
              <DialogTitle>Conexão</DialogTitle>
            </DialogHeader>
            {c.error ? <ErrorNotice error={c.error} /> : <LoadingRows rows={2} />}
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>{data.name}</DialogTitle>
              <DialogDescription className="break-all">
                {data.connector}
                {data.config.path && ` · ${data.config.path}`}
              </DialogDescription>
            </DialogHeader>
            <fieldset className="space-y-2 text-sm" disabled={data.status !== "active" || change.isPending}>
              <legend className="font-medium">Permissões</legend>
              <label className="flex items-center gap-2">
                <input type="checkbox" checked={data.permissions.read} onChange={(e) => change.mutate({ permissions: { read: e.target.checked } })} /> Ler documentos para o Cérebro
              </label>
              <label className="flex items-center gap-2">
                <input type="checkbox" checked={data.permissions.write} onChange={(e) => change.mutate({ permissions: { write: e.target.checked } })} /> Salvar entregas aceitas
              </label>
            </fieldset>
            {canRead && (
              <section className="space-y-2 text-sm">
                <h3 className="font-medium">Arquivos na pasta</h3>
                <ErrorNotice error={files.error ?? importFile.error} />
                {files.isPending ? (
                  <LoadingRows rows={2} />
                ) : files.data?.files.length ? (
                  <ul className="divide-y rounded-lg border">
                    {files.data.files.map((f) => (
                      <li key={f.name} className="flex flex-wrap items-center gap-2 p-3">
                        <span className="min-w-0 flex-1 truncate">{f.name}</span>
                        <span className="text-xs text-muted-foreground">
                          {formatBytes(f.size_bytes)} · {formatDateTime(f.modified_at)}
                        </span>
                        {imported[f.name] ? (
                          <span className="text-xs text-success">No Cérebro como “{imported[f.name]}”</span>
                        ) : (
                          <Button size="sm" variant="outline" disabled={importFile.isPending} onClick={() => importFile.mutate(f.name)}>
                            <Download /> Importar
                          </Button>
                        )}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-muted-foreground">Nenhum arquivo de texto, Markdown, CSV ou JSON no primeiro nível da pasta.</p>
                )}
              </section>
            )}
            <section className="space-y-2 text-sm">
              <h3 className="font-medium">Trilha</h3>
              <ol className="space-y-1">
                {[...data.history].reverse().map((e) => (
                  <li key={e.seq} className={e.kind === "action_blocked" ? "text-destructive" : undefined}>
                    {formatDateTime(e.at)} · {EVENT_LABEL[e.kind] ?? e.kind}
                    {typeof e.detail.file === "string" && ` · ${e.detail.file}`}
                    {e.kind === "action_blocked" && ` · ${String(e.detail.reason)}`}
                  </li>
                ))}
              </ol>
            </section>
            <ErrorNotice error={change.error} />
            <div className="flex justify-end">
              {data.status === "active" ? (
                <Button variant="outline" size="sm" disabled={change.isPending} onClick={() => change.mutate({ active: false })}>
                  Desconectar
                </Button>
              ) : (
                <Button size="sm" disabled={change.isPending} onClick={() => change.mutate({ active: true })}>
                  Reconectar
                </Button>
              )}
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
