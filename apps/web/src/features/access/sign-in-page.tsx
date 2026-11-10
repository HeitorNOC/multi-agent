/** Entrar no Aurora: Google, Microsoft ou e-mail e senha; no primeiro acesso, a conta do dono. */
import { useState, type FormEvent } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Sparkles } from "lucide-react";
import { ErrorNotice } from "@/components/common";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { authApi, type AuthStatus, type LoginProvider, type Me } from "@/lib/api";

type Mode = "sign-in" | "sign-up" | "setup";

/** Volta do Google/Microsoft com erro: `/entrar?erro=<código>`. */
const RETURN_ERRORS: Record<string, string> = {
  oauth_cancelled: "O login foi cancelado.",
  oauth_expired: "O login demorou demais ou foi aberto em outra janela. Tente de novo.",
  oauth_failed: "O provedor não confirmou quem é você. Tente de novo.",
  not_invited: "Este e-mail ainda não foi liberado. Peça acesso ao dono do Aurora.",
  email_not_verified: "O provedor não confirmou o seu e-mail. Use outra forma de entrar.",
  account_disabled: "Seu acesso foi suspenso pelo dono do Aurora.",
};

const PROVIDER_LABEL: Record<LoginProvider, string> = { google: "Google", microsoft: "Microsoft" };

export function SignInPage({ status }: { status: AuthStatus }) {
  const queryClient = useQueryClient();
  const [mode, setMode] = useState<Mode>(status.setup_required ? "setup" : "sign-in");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const returned = new URLSearchParams(window.location.search).get("erro");
  const submit = useMutation({
    mutationFn: (): Promise<Me> =>
      mode === "sign-in" ? authApi.signIn({ email, password }) : (mode === "setup" ? authApi.setup : authApi.signUp)({ name, email, password }),
    onSuccess: (me) => {
      if (window.location.pathname === "/entrar") window.history.replaceState(null, "", "/");
      queryClient.setQueryData(["me"], me);
      void queryClient.invalidateQueries({ queryKey: ["auth-status"] });
    },
  });
  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    submit.mutate();
  };
  const switchTo = (next: Mode) => {
    setMode(next);
    submit.reset();
  };

  const copy = {
    "sign-in": { title: "Entrar no Aurora", description: "Use a conta que o dono do Aurora liberou para você.", action: "Entrar" },
    "sign-up": { title: "Criar sua conta", description: "Para quem recebeu um convite: use o e-mail que foi liberado.", action: "Criar conta" },
    setup: { title: "Primeiro acesso", description: "Crie a conta do dono. Ela gerencia quem mais pode entrar e fica com o que já foi feito neste computador.", action: "Criar conta do dono" },
  }[mode];

  return (
    <div className="flex min-h-dvh items-center justify-center bg-muted/30 p-4">
      <div className="w-full max-w-sm space-y-6">
        <div className="flex items-center justify-center gap-2">
          <div className="flex size-9 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <Sparkles className="size-5" />
          </div>
          <span className="text-lg font-semibold">Aurora</span>
        </div>
        <Card>
          <CardHeader>
            <CardTitle>{copy.title}</CardTitle>
            <CardDescription>{copy.description}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {returned && RETURN_ERRORS[returned] && (
              <Alert variant="destructive">
                <AlertDescription>{RETURN_ERRORS[returned]}</AlertDescription>
              </Alert>
            )}
            {status.providers.length > 0 && (
              <>
                <div className="grid gap-2">
                  {status.providers.map((p) => (
                    <Button key={p} variant="outline" asChild>
                      <a href={authApi.providerUrl(p)}>
                        <ProviderMark provider={p} /> {mode === "sign-in" ? "Entrar" : "Continuar"} com {PROVIDER_LABEL[p]}
                      </a>
                    </Button>
                  ))}
                </div>
                <div className="flex items-center gap-3 text-xs text-muted-foreground">
                  <span className="h-px flex-1 bg-border" /> ou com e-mail <span className="h-px flex-1 bg-border" />
                </div>
              </>
            )}
            <form className="space-y-3" onSubmit={onSubmit}>
              {mode !== "sign-in" && (
                <div className="space-y-1.5">
                  <Label htmlFor="a-name">Seu nome</Label>
                  <Input id="a-name" autoComplete="name" value={name} maxLength={100} onChange={(e) => setName(e.target.value)} />
                </div>
              )}
              <div className="space-y-1.5">
                <Label htmlFor="a-email">E-mail</Label>
                <Input id="a-email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="a-password">Senha</Label>
                <Input
                  id="a-password"
                  type="password"
                  autoComplete={mode === "sign-in" ? "current-password" : "new-password"}
                  required
                  minLength={mode === "sign-in" ? undefined : 10}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
                {mode !== "sign-in" && <p className="text-xs text-muted-foreground">Pelo menos 10 caracteres.</p>}
              </div>
              <ErrorNotice error={submit.error} title="Não foi possível entrar" />
              <Button type="submit" className="w-full" disabled={submit.isPending}>
                {submit.isPending ? "Aguarde…" : copy.action}
              </Button>
            </form>
            {mode === "sign-in" && (
              <p className="text-center text-sm text-muted-foreground">
                Recebeu um convite?{" "}
                <button type="button" className="text-foreground underline underline-offset-4" onClick={() => switchTo("sign-up")}>
                  Criar conta
                </button>
              </p>
            )}
            {mode === "sign-up" && (
              <p className="text-center text-sm text-muted-foreground">
                Já tem conta?{" "}
                <button type="button" className="text-foreground underline underline-offset-4" onClick={() => switchTo("sign-in")}>
                  Entrar
                </button>
              </p>
            )}
            {mode === "setup" && status.providers.length > 0 && (
              <p className="text-center text-xs text-muted-foreground">Quem entrar primeiro com Google ou Microsoft também vira o dono.</p>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

/** Marca simples de cada provedor (só formas e cores, sem imagens externas). */
function ProviderMark({ provider }: { provider: LoginProvider }) {
  if (provider === "microsoft")
    return (
      <svg viewBox="0 0 16 16" aria-hidden className="size-4">
        <rect x="1" y="1" width="6.5" height="6.5" fill="#F25022" />
        <rect x="8.5" y="1" width="6.5" height="6.5" fill="#7FBA00" />
        <rect x="1" y="8.5" width="6.5" height="6.5" fill="#00A4EF" />
        <rect x="8.5" y="8.5" width="6.5" height="6.5" fill="#FFB900" />
      </svg>
    );
  return (
    <svg viewBox="0 0 48 48" aria-hidden className="size-4">
      <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" />
      <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
      <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z" />
      <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" />
    </svg>
  );
}
