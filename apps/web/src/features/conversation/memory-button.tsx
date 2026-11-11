/** Memória da conversa (N5): o que ficou decidido e o resumo do que saiu da janela do Chief. */
import { useState } from "react";
import { Brain } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { ConversationMemory } from "@/lib/api";
import { relativeTime } from "@/lib/format";

const KIND: Record<ConversationMemory["decisions"][number]["kind"], string> = {
  plan_approved: "Plano aprovado",
  plan_cancelled: "Planejamento cancelado",
  staffing: "Time",
  stated: "Combinado na conversa",
};

export function MemoryButton({ memory }: { memory: ConversationMemory }) {
  const [open, setOpen] = useState(false);
  const count = memory.decisions.length;
  return (
    <>
      <Button size="sm" variant="ghost" className="ml-auto" onClick={() => setOpen(true)} aria-label={`Memória da conversa: ${count} decisão(ões)`}>
        <Brain /> Memória{count ? ` (${count})` : ""}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Memória da conversa</DialogTitle>
            <DialogDescription>O que o Chief of Staff lembra daqui, mesmo depois de muitas mensagens.</DialogDescription>
          </DialogHeader>
          <section className="space-y-2">
            <h3 className="text-sm font-medium">Decisões</h3>
            {count ? (
              <ol className="space-y-2" aria-label="Decisões registradas">
                {memory.decisions.map((d, i) => (
                  <li key={`${i}-${d.text}`} className="rounded-md border p-2 text-sm">
                    <p>{d.text}</p>
                    <p className="text-xs text-muted-foreground">
                      {KIND[d.kind]} · {relativeTime(d.at)}
                    </p>
                  </li>
                ))}
              </ol>
            ) : (
              <p className="text-sm text-muted-foreground">Nada decidido ainda. Aprovar um plano, decidir uma contratação ou dizer “fica decidido…” registra aqui.</p>
            )}
          </section>
          {memory.summary && (
            <section className="space-y-2">
              <h3 className="text-sm font-medium">Resumo do que veio antes</h3>
              <pre className="max-h-60 overflow-auto whitespace-pre-wrap rounded-md bg-muted/50 p-2 font-sans text-xs">{memory.summary}</pre>
            </section>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
