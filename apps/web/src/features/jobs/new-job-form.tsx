/** Pedido livre ao Chief of Staff. A chave de idempotência é mantida até o envio dar certo. */
import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Send } from "lucide-react";
import { useNavigate } from "react-router";
import { ErrorNotice } from "@/components/common";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { jobsApi, newKey } from "@/lib/api";

const MIN = 10;
const MAX = 2000;

export function NewJobForm() {
  const [goal, setGoal] = useState("");
  const [key, setKey] = useState(newKey);
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const create = useMutation({
    mutationFn: () => jobsApi.create(goal.trim(), key),
    onSuccess: (job) => {
      setGoal("");
      setKey(newKey());
      void queryClient.invalidateQueries({ queryKey: ["jobs"] });
      void navigate(`/trabalhos/${job.id}`);
    },
  });
  const length = goal.trim().length;
  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (length >= MIN) create.mutate();
      }}
    >
      <label htmlFor="goal" className="text-sm font-medium">
        Novo pedido
      </label>
      <Textarea
        id="goal"
        value={goal}
        maxLength={MAX}
        rows={3}
        placeholder="Ex.: Avalie como devemos conduzir as compras de fornecedores acima de dez mil reais neste trimestre."
        onChange={(e) => {
          setGoal(e.target.value);
          // Texto novo é outro pedido: nova chave.
          if (create.isError) setKey(newKey());
        }}
      />
      <div className="flex items-center justify-between gap-3">
        <span className="text-xs text-muted-foreground">
          O Chief of Staff escolhe os especialistas; o parecer chega para sua aprovação. {length}/{MAX}
        </span>
        <Button type="submit" disabled={length < MIN || create.isPending}>
          <Send /> {create.isPending ? "Enviando…" : "Pedir"}
        </Button>
      </div>
      <ErrorNotice error={create.error} title="Pedido não enviado" />
    </form>
  );
}
