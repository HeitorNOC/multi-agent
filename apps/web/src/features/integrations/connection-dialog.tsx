/**
 * Uma conexão: navegar pelos itens (pasta local, Drive, Gmail, canais do Slack), importar para o
 * Cérebro, sincronizar o que mudou, permissões, reconectar e a trilha.
 */
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronRight, Download, Folder, RefreshCw, Search, TriangleAlert } from "lucide-react";
import { ErrorNotice, LoadingRows, ToneBadge } from "@/components/common";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { integrationsApi, type Connection } from "@/lib/api";
import { EVENT_LABEL, formatBytes, formatDateTime } from "@/lib/format";

type Detail = Awaited<ReturnType<typeof integrationsApi.get>>;

export function ConnectionDialog({ id, onClose }: { id: string; onClose: () => void }) {
  const queryClient = useQueryClient();
  const c = useQuery({ queryKey: ["connection", id], queryFn: () => integrationsApi.get(id) });
  const refresh = () => {
    for (const key of [["connection", id], ["connections"], ["integrations-catalog"]]) void queryClient.invalidateQueries({ queryKey: key });
  };
  const change = useMutation({ mutationFn: (input: Parameters<typeof integrationsApi.change>[1]) => integrationsApi.change(id, input), onSuccess: refresh });
  const data = c.data;
  const canRead = data?.status === "active" && data.permissions.read;
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
                {data.config.team && ` · ${data.config.team}`}
              </DialogDescription>
            </DialogHeader>
            {data.problem === "reauth_required" && <Reauthorize connection={data} onDone={refresh} />}
            <fieldset className="space-y-2 text-sm" disabled={data.status !== "active" || change.isPending}>
              <legend className="font-medium">Permissões</legend>
              <label className="flex items-center gap-2">
                <input type="checkbox" checked={data.permissions.read} onChange={(e) => change.mutate({ permissions: { read: e.target.checked } })} /> Ler para o Cérebro
              </label>
              {data.connector_id !== "gmail" && (
                <label className="flex items-center gap-2">
                  <input type="checkbox" checked={data.permissions.write} onChange={(e) => change.mutate({ permissions: { write: e.target.checked } })} /> Enviar entregas aceitas
                </label>
              )}
            </fieldset>
            {canRead && (data.connector_id === "local_folder" ? <FolderFiles id={id} /> : <ExternalBrowser connection={data} onChange={refresh} />)}
            <History data={data} />
            <ErrorNotice error={change.error} />
            <div className="flex justify-end">
              {data.status === "active" ? (
                <Button variant="outline" size="sm" disabled={change.isPending} onClick={() => change.mutate({ active: false })}>
                  Desconectar
                </Button>
              ) : data.connector_id === "local_folder" ? (
                <Button size="sm" disabled={change.isPending} onClick={() => change.mutate({ active: true })}>
                  Reconectar
                </Button>
              ) : (
                <Reauthorize connection={data} onDone={refresh} inline />
              )}
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

/** Acesso perdido (ou conexão desconectada): Google refaz o login; Slack pede token novo. */
function Reauthorize({ connection, onDone, inline }: { connection: Connection; onDone: () => void; inline?: boolean }) {
  const [token, setToken] = useState("");
  const save = useMutation({ mutationFn: () => integrationsApi.change(connection.id, { secret: { token: token.trim() }, active: true }), onSuccess: onDone });
  const google = connection.connector_id === "google_drive" || connection.connector_id === "gmail";
  const action = google ? (
    <Button size="sm" asChild>
      <a href={integrationsApi.googleUrl({ connector: connection.connector_id, name: connection.name, read: connection.permissions.read, write: connection.permissions.write, connection: connection.id })}>
        Entrar no Google de novo
      </a>
    </Button>
  ) : (
    <form
      className="flex flex-wrap gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        if (token.trim()) save.mutate();
      }}
    >
      <Input type="password" autoComplete="off" aria-label="Token novo" placeholder="xoxb-…" value={token} onChange={(e) => setToken(e.target.value)} className="w-56" />
      <Button size="sm" type="submit" disabled={!token.trim() || save.isPending}>
        Salvar token
      </Button>
      <ErrorNotice error={save.error} />
    </form>
  );
  if (inline) return action;
  return (
    <Alert variant="destructive">
      <TriangleAlert />
      <AlertDescription className="space-y-2">
        <p>O acesso a esta conta acabou (revogado ou expirado). Reconecte para voltar a ler e enviar.</p>
        {action}
      </AlertDescription>
    </Alert>
  );
}

function FolderFiles({ id }: { id: string }) {
  const queryClient = useQueryClient();
  const files = useQuery({ queryKey: ["connection-files", id], queryFn: () => integrationsApi.files(id), retry: false });
  const [imported, setImported] = useState<Record<string, string>>({});
  const importFile = useMutation({
    mutationFn: (file: string) => integrationsApi.importFile(id, file),
    onSuccess: (r, file) => {
      setImported((m) => ({ ...m, [file]: r.source.title }));
      void queryClient.invalidateQueries({ queryKey: ["sources"] });
      void queryClient.invalidateQueries({ queryKey: ["connection", id] });
    },
  });
  return (
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
        <p className="text-muted-foreground">Nenhum arquivo que o Cérebro lê no primeiro nível da pasta.</p>
      )}
    </section>
  );
}

const TITLES: Record<string, { list: string; search: string }> = {
  google_drive: { list: "Arquivos do Drive", search: "Buscar pelo nome do arquivo" },
  gmail: { list: "E-mails", search: "Busca do Gmail (ex.: from:fornecedor@alfa.com reajuste)" },
  slack: { list: "Canais", search: "Filtrar canais" },
};

/** Navega pelos itens do serviço: pastas (Drive), busca e páginas; importa e sincroniza. */
function ExternalBrowser({ connection, onChange }: { connection: Detail; onChange: () => void }) {
  const queryClient = useQueryClient();
  const [trail, setTrail] = useState<{ id: string; name: string }[]>([]);
  const [query, setQuery] = useState("");
  const [search, setSearch] = useState("");
  const [cursor, setCursor] = useState<string | undefined>();
  const parent = trail.at(-1)?.id;
  const items = useQuery({
    queryKey: ["connection-items", connection.id, parent ?? "", search, cursor ?? ""],
    queryFn: () => integrationsApi.browse(connection.id, { parent, q: search || undefined, cursor }),
    retry: false,
  });
  const done = () => {
    void queryClient.invalidateQueries({ queryKey: ["sources"] });
    void queryClient.invalidateQueries({ queryKey: ["connection-items", connection.id] });
    onChange();
  };
  const importItem = useMutation({ mutationFn: (item: string) => integrationsApi.importItem(connection.id, item), onSuccess: done });
  const sync = useMutation({ mutationFn: () => integrationsApi.sync(connection.id), onSuccess: done });
  const titles = TITLES[connection.connector_id] ?? { list: "Itens", search: "Buscar" };
  const open = (id: string, name: string) => {
    setTrail((t) => [...t, { id, name }]);
    setCursor(undefined);
  };
  return (
    <section className="space-y-3 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-medium">{titles.list}</h3>
        {connection.imported.length > 0 && (
          <Button size="sm" variant="outline" disabled={sync.isPending} onClick={() => sync.mutate()}>
            <RefreshCw className={sync.isPending ? "animate-spin" : undefined} /> Sincronizar {connection.imported.length} importado(s)
          </Button>
        )}
      </div>
      {sync.data && (
        <p className="text-xs text-muted-foreground">
          {sync.data.updated.length} atualizado(s), {sync.data.unchanged.length} sem mudança
          {sync.data.failed.length > 0 && `, ${sync.data.failed.length} com falha (${sync.data.failed.map((f) => f.item).join(", ")})`}.
        </p>
      )}
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          setSearch(query.trim());
          setCursor(undefined);
        }}
      >
        <Input aria-label={titles.search} placeholder={titles.search} value={query} onChange={(e) => setQuery(e.target.value)} />
        <Button type="submit" size="icon" variant="outline" aria-label="Buscar">
          <Search />
        </Button>
      </form>
      {connection.connector_id === "google_drive" && !search && (
        <nav className="flex flex-wrap items-center gap-1 text-xs" aria-label="Pastas">
          <button type="button" className="hover:underline" onClick={() => setTrail([])}>
            Meu Drive
          </button>
          {trail.map((t, i) => (
            <span key={t.id} className="inline-flex items-center gap-1">
              <ChevronRight className="size-3" />
              <button type="button" className="hover:underline" onClick={() => setTrail((x) => x.slice(0, i + 1))}>
                {t.name}
              </button>
            </span>
          ))}
        </nav>
      )}
      <ErrorNotice error={items.error ?? importItem.error ?? sync.error} />
      {items.isPending ? (
        <LoadingRows rows={3} />
      ) : items.data?.items.length ? (
        <ul className="divide-y rounded-lg border">
          {items.data.items.map((item) => (
            <li key={item.id} className="flex flex-wrap items-center gap-2 p-3">
              {item.kind === "folder" ? (
                <button type="button" className="inline-flex min-w-0 flex-1 items-center gap-2 text-left hover:underline" onClick={() => open(item.id, item.name)}>
                  <Folder className="size-4 shrink-0 text-muted-foreground" /> <span className="truncate">{item.name}</span>
                </button>
              ) : (
                <div className="min-w-0 flex-1">
                  <p className="truncate">{item.name}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    {[item.detail, item.modified_at && formatDateTime(item.modified_at), item.size_bytes ? formatBytes(item.size_bytes) : null].filter(Boolean).join(" · ")}
                  </p>
                </div>
              )}
              <span className="rounded border px-1.5 py-0.5 font-mono text-[10px] uppercase text-muted-foreground">{item.label}</span>
              {item.kind !== "folder" &&
                (item.importable ? (
                  <Button size="sm" variant="outline" disabled={importItem.isPending && importItem.variables === item.id} onClick={() => importItem.mutate(item.id)}>
                    <Download /> {item.source ? "Atualizar" : "Importar"}
                  </Button>
                ) : (
                  <span className="text-xs text-muted-foreground">Não lido pelo Cérebro</span>
                ))}
              {item.source && <ToneBadge tone="success">No Cérebro</ToneBadge>}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-muted-foreground">Nada aqui.</p>
      )}
      {items.data?.cursor && (
        <Button size="sm" variant="ghost" onClick={() => setCursor(items.data!.cursor!)}>
          Próxima página
        </Button>
      )}
    </section>
  );
}

function History({ data }: { data: Detail }) {
  return (
    <section className="space-y-2 text-sm">
      <h3 className="font-medium">Trilha</h3>
      <ol className="max-h-48 space-y-1 overflow-y-auto">
        {[...data.history].reverse().map((e) => (
          <li key={e.seq} className={e.kind === "action_blocked" || e.kind === "connection_problem" ? "text-destructive" : undefined}>
            {formatDateTime(e.at)} · {EVENT_LABEL[e.kind] ?? e.kind}
            {typeof e.detail.file === "string" && ` · ${e.detail.file}`}
            {e.kind === "action_blocked" && ` · ${String(e.detail.reason)}`}
          </li>
        ))}
      </ol>
    </section>
  );
}
