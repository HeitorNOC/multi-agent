/** Integrações: catálogo por categoria, conexões da empresa e o que cada uma pode fazer. */
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Blocks, FolderOpen, Hash, Mail, Plug, TriangleAlert } from "lucide-react";
import { useSearchParams } from "react-router";
import { ErrorNotice, LoadingRows, PageHeader, ToneBadge } from "@/components/common";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { integrationsApi, type Connection, type ConnectorDef } from "@/lib/api";
import { ConnectionDialog } from "./connection-dialog";

/** Volta do Google com erro: `/integracoes?erro=<código>`. */
const RETURN_ERRORS: Record<string, string> = {
  google_cancelled: "A conexão com o Google foi cancelada.",
  google_expired: "O login no Google demorou demais ou foi aberto em outra janela. Tente de novo.",
  google_no_refresh_token: "O Google não liberou acesso contínuo. Remova o acesso do Aurora em myaccount.google.com › Segurança e conecte de novo.",
  google_token_failed: "O Google recusou o acesso. Confira o ID e o segredo do cliente OAuth.",
  google_forbidden: "A conta não deu as permissões pedidas. Conecte de novo e marque todas as caixas.",
};

const ICON = { local_folder: FolderOpen, google_drive: FolderOpen, gmail: Mail, slack: Hash } as Record<string, typeof FolderOpen>;

export function IntegrationsPage() {
  const catalog = useQuery({ queryKey: ["integrations-catalog"], queryFn: integrationsApi.catalog });
  const connections = useQuery({ queryKey: ["connections"], queryFn: integrationsApi.list });
  const [params, setParams] = useSearchParams();
  const [connecting, setConnecting] = useState<ConnectorDef | null>(null);
  const [open, setOpen] = useState<string | null>(params.get("conectado"));
  const returned = params.get("erro");
  return (
    <div className="space-y-6">
      <PageHeader title="Integrações" description="Conecte o Aurora aos sistemas da empresa. Cada conexão diz o que pode ler e escrever; o resto é recusado e fica registrado." />
      {returned && (
        <Alert variant="destructive">
          <AlertDescription className="flex flex-wrap items-center justify-between gap-2">
            {RETURN_ERRORS[returned] ?? `Não foi possível conectar (${returned}).`}
            <Button size="sm" variant="ghost" onClick={() => setParams({})}>
              Fechar
            </Button>
          </AlertDescription>
        </Alert>
      )}
      <ErrorNotice error={catalog.error ?? connections.error} />
      {!!connections.data?.connections.length && (
        <section className="space-y-3">
          <h2 className="text-sm font-medium">Suas conexões</h2>
          <ul className="divide-y rounded-xl border">
            {connections.data.connections.map((c) => (
              <li key={c.id}>
                <ConnectionRow connection={c} onOpen={() => setOpen(c.id)} />
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
                    {!c.available ? (
                      <ToneBadge tone="neutral">Em breve</ToneBadge>
                    ) : (
                      <Button size="sm" variant={c.ready ? "default" : "outline"} onClick={() => setConnecting(c)}>
                        <Plug /> {c.ready ? "Conectar" : "Como configurar"}
                      </Button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </section>
        ))
      )}
      {connecting && <ConnectDialog connector={connecting} onClose={() => setConnecting(null)} onConnected={(id) => setOpen(id)} />}
      {open && (
        <ConnectionDialog
          id={open}
          onClose={() => {
            setOpen(null);
            if (params.get("conectado")) setParams({});
          }}
        />
      )}
    </div>
  );
}

function ConnectionRow({ connection: c, onOpen }: { connection: Connection; onOpen: () => void }) {
  const Icon = ICON[c.connector_id] ?? Blocks;
  const where = c.config.path ?? c.config.team ?? null;
  return (
    <button type="button" onClick={onOpen} className="flex w-full flex-col gap-2 p-4 text-left hover:bg-muted/50 sm:flex-row sm:items-center">
      <Icon className="size-5 shrink-0 text-muted-foreground" />
      <div className="min-w-0 flex-1">
        <p className="font-medium">{c.name}</p>
        <p className="truncate text-xs text-muted-foreground">
          {c.connector}
          {where && ` · ${where}`}
        </p>
      </div>
      <div className="flex flex-wrap gap-1">
        {c.problem === "reauth_required" && (
          <ToneBadge tone="danger">
            <TriangleAlert className="size-3" /> Reconectar
          </ToneBadge>
        )}
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
  );
}

/** Conectar: pasta (caminho), Google (login na conta) ou Slack (token do app). */
function ConnectDialog({ connector, onClose, onConnected }: { connector: ConnectorDef; onClose: () => void; onConnected: (id: string) => void }) {
  const queryClient = useQueryClient();
  const [name, setName] = useState(connector.auth === "none" ? "Documentos da empresa" : connector.name);
  const [path, setPath] = useState("");
  const [token, setToken] = useState("");
  const [channel, setChannel] = useState("");
  const [read, setRead] = useState(!!connector.capabilities.read);
  const [write, setWrite] = useState(false);
  const connect = useMutation({
    mutationFn: () =>
      integrationsApi.connect({
        connector_id: connector.id,
        name: name.trim(),
        config: connector.auth === "none" ? { path: path.trim() } : channel.trim() ? { channel_id: channel.trim() } : {},
        permissions: { read, write },
        ...(connector.auth === "token" ? { secret: { token: token.trim() } } : {}),
      }),
    onSuccess: (c) => {
      void queryClient.invalidateQueries({ queryKey: ["connections"] });
      void queryClient.invalidateQueries({ queryKey: ["integrations-catalog"] });
      onClose();
      onConnected(c.id);
    },
  });
  const filled = connector.auth === "none" ? !!path.trim() : connector.auth === "token" ? !!token.trim() : true;
  const ready = connector.ready && name.trim().length >= 2 && filled && (read || write);
  const callback = `${window.location.origin}/api/integrations/google/callback`;
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Conectar {connector.name}</DialogTitle>
          <DialogDescription>{connector.description}</DialogDescription>
        </DialogHeader>
        {connector.setup && (
          <details className="rounded-lg border p-3 text-sm" open={!connector.ready}>
            <summary className="cursor-pointer font-medium">Como criar o acesso</summary>
            <ol className="mt-2 list-decimal space-y-1 pl-5 text-muted-foreground">
              {connector.setup.map((step) => (
                <li key={step}>{step}</li>
              ))}
            </ol>
            {connector.auth === "google" && (
              <p className="mt-2 text-xs">
                Endereço de retorno: <code className="break-all rounded bg-muted px-1">{callback}</code>
              </p>
            )}
          </details>
        )}
        {!connector.ready ? (
          <Alert>
            <AlertDescription>Falta configurar nesta instalação: {connector.missing}. Depois, reinicie o Aurora.</AlertDescription>
          </Alert>
        ) : (
          <form
            id="connect"
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              if (!ready) return;
              // Google: o navegador vai até a conta e volta já conectado.
              if (connector.auth === "google") window.location.assign(integrationsApi.googleUrl({ connector: connector.id, name: name.trim(), read, write }));
              else connect.mutate();
            }}
          >
            <div className="space-y-2">
              <Label htmlFor="c-name">Nome da conexão</Label>
              <Input id="c-name" maxLength={80} value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            {connector.auth === "none" && (
              <div className="space-y-2">
                <Label htmlFor="c-path">Caminho completo da pasta neste computador</Label>
                <Input id="c-path" maxLength={500} value={path} onChange={(e) => setPath(e.target.value)} placeholder="C:\Users\voce\Documents\Empresa" />
              </div>
            )}
            {connector.auth === "token" && (
              <>
                <div className="space-y-2">
                  <Label htmlFor="c-token">Bot User OAuth Token</Label>
                  <Input id="c-token" type="password" autoComplete="off" value={token} onChange={(e) => setToken(e.target.value)} placeholder="xoxb-…" />
                  <p className="text-xs text-muted-foreground">Fica cifrado neste computador e nunca é mostrado de novo.</p>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="c-channel">Canal para publicar entregas (opcional)</Label>
                  <Input id="c-channel" value={channel} onChange={(e) => setChannel(e.target.value)} placeholder="C0123ABCD" />
                  <p className="text-xs text-muted-foreground">No Slack: abra o canal › nome do canal › o id aparece no fim da janela.</p>
                </div>
              </>
            )}
            <fieldset className="space-y-2 text-sm">
              <legend className="font-medium">O que o Aurora pode fazer</legend>
              {connector.capabilities.read && (
                <label className="flex items-start gap-2">
                  <input type="checkbox" className="mt-1" checked={read} onChange={(e) => setRead(e.target.checked)} />
                  <span>Ler: {connector.capabilities.read}</span>
                </label>
              )}
              {connector.capabilities.write && (
                <label className="flex items-start gap-2">
                  <input type="checkbox" className="mt-1" checked={write} onChange={(e) => setWrite(e.target.checked)} />
                  <span>
                    Escrever: {connector.capabilities.write}
                    <span className="block text-xs text-muted-foreground">Só entregas que você aceitou, e só quando você manda. Nunca apaga nem sobrescreve.</span>
                  </span>
                </label>
              )}
            </fieldset>
            <ErrorNotice error={connect.error} title="Não conectou" />
          </form>
        )}
        {connector.ready && (
          <DialogFooter>
            <Button type="submit" form="connect" disabled={!ready || connect.isPending}>
              {connector.auth === "google" ? "Entrar no Google e conectar" : "Conectar"}
            </Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}
