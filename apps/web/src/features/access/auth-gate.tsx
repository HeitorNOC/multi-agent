/**
 * Porta de entrada: sem sessão, mostra o login (ou o primeiro acesso do dono); com sessão, o app.
 * Se a sessão acabar no meio do uso (401), volta sozinho para o login.
 */
import { createContext, useContext, useEffect, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ErrorNotice } from "@/components/common";
import { Button } from "@/components/ui/button";
import { ApiError, authApi, SIGNED_OUT_EVENT, type AuthStatus, type Me } from "@/lib/api";
import { SignInPage } from "./sign-in-page";

interface Access {
  me: Me;
  mode: AuthStatus["mode"];
}

const AccessContext = createContext<Access | null>(null);

/** Quem está usando e o modo de acesso da instalação. */
export function useAccess(): Access {
  const access = useContext(AccessContext);
  if (!access) throw new Error("useAccess fora do AuthGate");
  return access;
}

export function AuthGate({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const status = useQuery({ queryKey: ["auth-status"], queryFn: authApi.status });
  const me = useQuery({
    queryKey: ["me"],
    queryFn: authApi.me,
    enabled: !!status.data,
    retry: (count, error) => !(error instanceof ApiError && error.status === 401) && count < 2,
  });

  useEffect(() => {
    const signedOut = () => {
      // Esquece tudo o que foi carregado com a sessão anterior.
      queryClient.removeQueries({ predicate: (q) => q.queryKey[0] !== "auth-status" && q.queryKey[0] !== "me" });
      void queryClient.resetQueries({ queryKey: ["me"] });
      void queryClient.invalidateQueries({ queryKey: ["auth-status"] });
    };
    window.addEventListener(SIGNED_OUT_EVENT, signedOut);
    return () => window.removeEventListener(SIGNED_OUT_EVENT, signedOut);
  }, [queryClient]);

  if (status.error || (me.error && !(me.error instanceof ApiError && me.error.status === 401)))
    return (
      <Centered>
        <ErrorNotice error={status.error ?? me.error} />
        <Button variant="outline" onClick={() => void Promise.all([status.refetch(), me.refetch()])}>
          Tentar de novo
        </Button>
      </Centered>
    );
  if (!status.data || me.isPending) return <Centered><span className="text-sm text-muted-foreground">Abrindo o Aurora…</span></Centered>;
  if (me.data) return <AccessContext.Provider value={{ me: me.data, mode: status.data.mode }}>{children}</AccessContext.Provider>;
  return <SignInPage status={status.data} />;
}

function Centered({ children }: { children: ReactNode }) {
  return <div className="flex min-h-dvh flex-col items-center justify-center gap-4 p-4">{children}</div>;
}
