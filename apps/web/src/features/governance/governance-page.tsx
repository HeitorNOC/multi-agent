/**
 * Central de recuperação: trabalhos cujo resultado não é conhecido. Nada é repetido sem uma
 * pessoa conferir os passos pendentes e justificar a decisão.
 */
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ShieldCheck } from "lucide-react";
import { Link } from "react-router";
import { EmptyState, ErrorNotice, LoadingRows, PageHeader } from "@/components/common";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { recoveryApi, type RecoveryCase } from "@/lib/api";
import { EVENT_LABEL, formatDateTime, shortId } from "@/lib/format";

export function GovernancePage() {
  const cases = useQuery({ queryKey: ["recovery"], queryFn: recoveryApi.cases, refetchInterval: 5000 });
  return (
    <div className="space-y-6">
      <PageHeader title="Governança" description="Central de recuperação: decisões humanas sobre o que ficou sem confirmação." />
      <ErrorNotice error={cases.error} title="Não foi possível carregar a central" />
      {cases.isPending ? (
        <LoadingRows />
      ) : !cases.data?.cases.length ? (
        <EmptyState icon={<ShieldCheck />} title="Nada aguardando revisão">
          Quando uma chamada ao modelo ficar sem recibo (por exemplo, numa queda), o trabalho aparece aqui e não é repetido sem sua decisão.
        </EmptyState>
      ) : (
        <div className="space-y-4">
          {cases.data.cases.map((c) => (
            <CaseCard key={c.job.id} item={c} />
          ))}
        </div>
      )}
    </div>
  );
}

const MIN_REASON = 20;

function CaseCard({ item }: { item: RecoveryCase }) {
  const queryClient = useQueryClient();
  const [reason, setReason] = useState("");
  const done = () => {
    void queryClient.invalidateQueries({ queryKey: ["recovery"] });
    void queryClient.invalidateQueries({ queryKey: ["jobs"] });
    void queryClient.invalidateQueries({ queryKey: ["job", item.job.id] });
  };
  const steps = item.pending_steps.map((s) => s.slot);
  const retry = useMutation({ mutationFn: () => recoveryApi.retry(item.job.id, reason.trim(), steps), onSuccess: done });
  const close = useMutation({ mutationFn: () => recoveryApi.close(item.job.id, reason.trim()), onSuccess: done });
  const busy = retry.isPending || close.isPending || item.job.worker_active;
  const valid = reason.trim().length >= MIN_REASON;
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">
          <Link to={`/trabalhos/${item.job.id}`} className="hover:underline">
            {item.job.goal}
          </Link>
        </CardTitle>
        <CardDescription>
          #{shortId(item.job.id)} · {item.job.error}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        <div>
          <p className="font-medium">Passos sem confirmação</p>
          {steps.length ? (
            <ul className="mt-1 list-disc pl-5 text-muted-foreground">
              {item.pending_steps.map((s) => (
                <li key={s.slot}>
                  {s.slot} · reservado {formatDateTime(s.reserved_at)}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-muted-foreground">Nenhum passo pendente registrado.</p>
          )}
        </div>
        <div>
          <p className="font-medium">Evidência</p>
          <ul className="mt-1 space-y-1 text-muted-foreground">
            {item.evidence.map((e) => (
              <li key={e.seq}>
                {formatDateTime(e.at)} · {EVENT_LABEL[e.kind] ?? e.kind}
              </li>
            ))}
          </ul>
        </div>
        <div className="space-y-2">
          <label htmlFor={`reason-${item.job.id}`} className="font-medium">
            Justificativa (obrigatória)
          </label>
          <Textarea
            id={`reason-${item.job.id}`}
            value={reason}
            maxLength={500}
            rows={2}
            placeholder="Ex.: Conferi no provedor que a chamada não foi concluída nem cobrada."
            onChange={(e) => setReason(e.target.value)}
          />
          <p className="text-xs text-muted-foreground">
            {reason.trim().length}/{MIN_REASON} caracteres no mínimo. Fica registrada na trilha com seu nome.
          </p>
        </div>
        <ErrorNotice error={retry.error ?? close.error} />
        <div className="flex flex-wrap gap-2">
          <Button disabled={!valid || busy || !steps.length} onClick={() => retry.mutate()}>
            Autorizar repetir {steps.length} passo(s)
          </Button>
          <Button variant="outline" disabled={!valid || busy} onClick={() => close.mutate()}>
            Encerrar sem resultado confirmado
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
