/** Integrações: catálogo por categoria, conexões da empresa e o que cada uma pode fazer. */
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Blocks, FolderOpen, Plug } from "lucide-react";
import { ErrorNotice, LoadingRows, PageHeader, ToneBadge } from "@/components/common";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { integrationsApi, type ConnectorDef } from "@/lib/api";
import { ConnectionDialog } from "./connection-dialog";

export function IntegrationsPage() {
  const catalog = useQuery({ queryKey: ["integrations-catalog"], queryFn: integrationsApi.catalog });
  const connections = useQuery({ queryKey: ["connections"], queryFn: integrationsApi.list });
  const [connecting, setConnecting] = useState<ConnectorDef | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  return (
    <div className="space-y-6">
      <PageHeader title="Integrações" description="Conecte o Aurora aos sistemas da empresa. Cada conexão diz o que pode ler e escrever; o resto é recusado e fica registrado." />
      <ErrorNotice error={catalog.error ?? connections.error} />
      {!!connections.data?.connections.length && (
        <section className="space-y-3">
          <h2 className="text-sm font-medium">Suas conexões</h2>
          <ul className="divide-y rounded-xl border">
            {connections.data.connections.map((c) => (
              <li key={c.id}>
                <button type="button" onClick={() => setOpen(c.id)} className="flex w-full flex-col gap-2 p-4 text-left hover:bg-muted/50 sm:flex-row sm:items-center">
                  <FolderOpen className="size-5 shrink-0 text-muted-foreground" />
                  <div className="min-w-0 flex-1">
                    <p className="font-medium">{c.name}</p>
                    <p className="truncate text-xs text-muted-foreground">
                      {c.connector}
                      {c.config.path && ` · ${c.config.path}`}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {c.status === "disconnected" ? (
                      <ToneBadge tone="neutral">Desconectada</ToneBadge>
                    ) : (
                      <>
                        {c.permissions.read && <ToneBadge tone="info">Lê</ToneBadge>}
                        {c.permissions.write && <ToneBadge tone="warning">Escreve</ToneBadge>}
                      </>
                    )}
                  </div>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
      {catalog.isPending ? (
        <LoadingRows />
      ) : (
        catalog.data?.categories.map((cat) => (
          <section key={cat.id} className="space-y-3">
            <h2 className="text-sm font-medium">{cat.title}</h2>
            <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {cat.connectors.map((c) => (
                <li key={c.id} className="flex flex-col gap-3 rounded-xl border bg-card p-4">
                  <div className="flex items-center gap-2">
                    <Blocks className="size-4 text-muted-foreground" />
                    <p className="font-medium">{c.name}</p>
                    {c.connections > 0 && <ToneBadge tone="success">{c.connections} conectada(s)</ToneBadge>}
                  </div>
                  <p className="text-sm text-muted-foreground">{c.description}</p>
                  <ul className="space-y-1 text-xs">
                    {c.capabilities.read && <li>Leitura: {c.capabilities.read}</li>}
                    {c.capabilities.write && <li>Escrita: {c.capabilities.write}</li>}
                  </ul>
                  <div className="mt-auto">
                    {c.available ? (
                      <Button size="sm" onClick={() => setConnecting(c)}>
                        <Plug /> Conectar
                      </Button>
                    ) : (
                      <ToneBadge tone="neutral">Em breve</ToneBadge>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </section>
        ))
      )}
      {connecting && <ConnectFolderDialog connector={connecting} onClose={() => setConnecting(null)} onConnected={(id) => setOpen(id)} />}
      {open && <ConnectionDialog id={open} onClose={() => setOpen(null)} />}
    </div>
  );
}

function ConnectFolderDialog({ connector, onClose, onConnected }: { connector: ConnectorDef; onClose: () => void; onConnected: (id: string) => void }) {
  const queryClient = useQueryClient();
  const [name, setName] = useState("Documentos da empresa");
  const [path, setPath] = useState("");
  const [read, setRead] = useState(true);
  const [write, setWrite] = useState(false);
  const connect = useMutation({
    mutationFn: () => integrationsApi.connect({ connector_id: connector.id, name: name.trim(), config: { path: path.trim() }, permissions: { read, write } }),
    onSuccess: (c) => {
      void queryClient.invalidateQueries({ queryKey: ["connections"] });
      void queryClient.invalidateQueries({ queryKey: ["integrations-catalog"] });
      onClose();
      onConnected(c.id);
    },
  });
  const ready = name.trim().length >= 2 && path.trim() && (read || write);
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Conectar {connector.name}</DialogTitle>
          <DialogDescription>{connector.description}</DialogDescription>
        </DialogHeader>
        <form
          id="connect-folder"
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (ready) connect.mutate();
          }}
        >
          <div className="space-y-2">
            <Label htmlFor="c-name">Nome da conexão</Label>
            <Input id="c-name" maxLength={80} value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="c-path">Caminho completo da pasta neste computador</Label>
            <Input id="c-path" maxLength={500} value={path} onChange={(e) => setPath(e.target.value)} placeholder="C:\Users\voce\Documents\Empresa" />
          </div>
          <fieldset className="space-y-2 text-sm">
            <legend className="font-medium">O que o Aurora pode fazer</legend>
            <label className="flex items-start gap-2">
              <input type="checkbox" className="mt-1" checked={read} onChange={(e) => setRead(e.target.checked)} />
              <span>
                Ler: {connector.capabilities.read}
                <span className="block text-xs text-muted-foreground">Só arquivos de texto, Markdown, CSV e JSON do primeiro nível da pasta.</span>
              </span>
            </label>
            <label className="flex items-start gap-2">
              <input type="checkbox" className="mt-1" checked={write} onChange={(e) => setWrite(e.target.checked)} />
              <span>
                Escrever: {connector.capabilities.write}
                <span className="block text-xs text-muted-foreground">Nunca sobrescreve: um nome repetido ganha um número.</span>
              </span>
            </label>
          </fieldset>
          <ErrorNotice error={connect.error} title="Não conectou" />
        </form>
        <DialogFooter>
          <Button type="submit" form="connect-folder" disabled={!ready || connect.isPending}>
            Conectar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
