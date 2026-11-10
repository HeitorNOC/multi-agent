/** Configurações › Acesso: quem entra no Aurora, convites e como configurar Google/Microsoft. */
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { MailPlus, X } from "lucide-react";
import { ErrorNotice, LoadingRows, ToneBadge } from "@/components/common";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { accessApi, type AccessList, type Role, type Settings } from "@/lib/api";
import { relativeTime } from "@/lib/format";
import { useAccess } from "./auth-gate";

const METHOD = { google: "Google", microsoft: "Microsoft" } as const;
const ROLE: Record<Role, string> = { owner: "Dono", member: "Membro" };

export function AccessCard({ auth }: { auth: Settings["auth"] | undefined }) {
  const { me, mode } = useAccess();
  if (mode === "local")
    return (
      <Card>
        <CardHeader>
          <CardTitle>Acesso</CardTitle>
          <CardDescription>Uso individual, sem login (AURORA_AUTH=local). Para cada pessoa entrar com a própria conta, suba a API sem essa variável.</CardDescription>
        </CardHeader>
      </Card>
    );
  return (
    <Card>
      <CardHeader>
        <CardTitle>Acesso</CardTitle>
        <CardDescription>Quem pode entrar no Aurora. Só o dono libera e-mails e suspende contas.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {me.role === "owner" ? <People selfId={me.id} /> : <p className="text-sm text-muted-foreground">Peça ao dono do Aurora para liberar o acesso de outras pessoas.</p>}
        {auth && <LoginProviders auth={auth} />}
      </CardContent>
    </Card>
  );
}

function People({ selfId }: { selfId: string }) {
  const queryClient = useQueryClient();
  const access = useQuery({ queryKey: ["access"], queryFn: accessApi.list });
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<Role>("member");
  const update = (data: AccessList) => queryClient.setQueryData(["access"], data);
  const add = useMutation({
    mutationFn: () => accessApi.invite(email, role),
    onSuccess: (data) => {
      update(data);
      setEmail("");
    },
  });
  const remove = useMutation({ mutationFn: accessApi.removeInvite, onSuccess: update });
  const toggle = useMutation({ mutationFn: (v: { id: string; enabled: boolean }) => accessApi.setEnabled(v.id, v.enabled), onSuccess: update });
  if (!access.data) return access.error ? <ErrorNotice error={access.error} /> : <LoadingRows rows={2} />;
  const { accounts, invites } = access.data;
  return (
    <div className="space-y-4">
      <ul className="divide-y rounded-lg border text-sm">
        {accounts.map((a) => (
          <li key={a.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 p-3">
            <div className="min-w-0 flex-1">
              <p className="font-medium">
                {a.name} <span className="font-normal text-muted-foreground">· {a.email}</span>
              </p>
              <p className="text-xs text-muted-foreground">
                {ROLE[a.role]} · entra com {[a.password && "senha", ...a.providers.map((p) => METHOD[p])].filter(Boolean).join(", ")} · desde {relativeTime(a.created_at)}
              </p>
            </div>
            {a.disabled && <ToneBadge tone="warning">Suspenso</ToneBadge>}
            {a.id !== selfId && (
              <Button variant="ghost" size="sm" disabled={toggle.isPending} onClick={() => toggle.mutate({ id: a.id, enabled: a.disabled })}>
                {a.disabled ? "Reativar" : "Suspender"}
              </Button>
            )}
          </li>
        ))}
        {invites.map((i) => (
          <li key={i.email} className="flex items-center gap-3 p-3">
            <div className="min-w-0 flex-1">
              <p className="truncate">{i.email}</p>
              <p className="text-xs text-muted-foreground">Convite pendente · {ROLE[i.role]} · {relativeTime(i.created_at)}</p>
            </div>
            <Button variant="ghost" size="icon" className="size-8" aria-label={`Cancelar convite de ${i.email}`} disabled={remove.isPending} onClick={() => remove.mutate(i.email)}>
              <X />
            </Button>
          </li>
        ))}
      </ul>
      <form
        className="flex flex-col gap-2 sm:flex-row"
        onSubmit={(e) => {
          e.preventDefault();
          if (email.trim()) add.mutate();
        }}
      >
        <Input type="email" placeholder="email@empresa.com" aria-label="E-mail para liberar" value={email} onChange={(e) => setEmail(e.target.value)} className="sm:flex-1" />
        <select aria-label="Papel" className="h-9 rounded-md border bg-transparent px-2 text-sm" value={role} onChange={(e) => setRole(e.target.value as Role)}>
          <option value="member">Membro</option>
          <option value="owner">Dono</option>
        </select>
        <Button type="submit" disabled={!email.trim() || add.isPending}>
          <MailPlus /> Liberar acesso
        </Button>
      </form>
      <p className="text-xs text-muted-foreground">A pessoa entra com Google ou Microsoft usando esse e-mail, ou cria uma senha em “Criar conta”. O Aurora não envia e-mail: avise você mesmo.</p>
      <ErrorNotice error={add.error ?? remove.error ?? toggle.error} />
    </div>
  );
}

function LoginProviders({ auth }: { auth: Settings["auth"] }) {
  const origin = window.location.origin;
  const rows = [
    { id: "google", label: "Google", on: auth.google, vars: "AURORA_GOOGLE_CLIENT_ID e AURORA_GOOGLE_CLIENT_SECRET", where: "Google Cloud › APIs e serviços › Credenciais › ID do cliente OAuth (Aplicativo da Web)" },
    { id: "microsoft", label: "Microsoft", on: auth.microsoft, vars: "AURORA_MICROSOFT_CLIENT_ID, AURORA_MICROSOFT_CLIENT_SECRET e, se quiser só a sua empresa, AURORA_MICROSOFT_TENANT", where: "Entra ID › Registros de aplicativo › Autenticação (plataforma Web)" },
  ];
  return (
    <section className="space-y-2">
      <h3 className="text-sm font-medium">Entrar com Google e Microsoft</h3>
      <ul className="space-y-2 text-sm">
        {rows.map((r) => (
          <li key={r.id} className="space-y-1 rounded-lg border p-3">
            <div className="flex items-center gap-2">
              <span className="font-medium">{r.label}</span>
              {r.on ? <ToneBadge tone="success">Ativo</ToneBadge> : <ToneBadge tone="neutral">Não configurado</ToneBadge>}
            </div>
            {!r.on && <p className="text-xs text-muted-foreground">Crie o aplicativo em {r.where} e suba a API com {r.vars}.</p>}
            <p className="text-xs text-muted-foreground">
              Endereço de retorno para cadastrar: <code className="break-all rounded bg-muted px-1">{`${origin}/api/auth/oauth/${r.id}/callback`}</code>
            </p>
          </li>
        ))}
      </ul>
    </section>
  );
}
