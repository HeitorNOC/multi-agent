/** Rodapé do menu: quem está usando e o botão de sair. */
import { useMutation } from "@tanstack/react-query";
import { LogOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import { authApi, SIGNED_OUT_EVENT } from "@/lib/api";
import { useAccess } from "./auth-gate";

export function SignedInAs() {
  const { me, mode } = useAccess();
  const signOut = useMutation({
    mutationFn: authApi.signOut,
    onSettled: () => window.dispatchEvent(new Event(SIGNED_OUT_EVENT)),
  });
  if (mode === "local") return <p className="px-2 pb-1 text-xs text-muted-foreground">Operador local</p>;
  return (
    <div className="flex items-center gap-2 px-2 pb-1">
      <div className="grid min-w-0 flex-1 leading-tight">
        <span className="truncate text-sm font-medium">{me.name}</span>
        <span className="truncate text-xs text-muted-foreground">{me.role === "owner" ? "Dono · " : ""}{me.email}</span>
      </div>
      <Button variant="ghost" size="icon" className="size-8" aria-label="Sair" title="Sair" disabled={signOut.isPending} onClick={() => signOut.mutate()}>
        <LogOut />
      </Button>
    </div>
  );
}
