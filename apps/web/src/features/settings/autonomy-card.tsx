/**
 * Alçadas do Chief of Staff sobre o time: o que ele faz sozinho e o que propõe para você aprovar.
 * Você continua podendo tudo pela tela de Agentes; isto vale para as decisões do Chief.
 */
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check } from "lucide-react";
import { ErrorNotice, Field, LoadingRows, Segmented } from "@/components/common";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { agentsApi, type Autonomy } from "@/lib/api";
import { cn } from "@/lib/utils";

const HIRE = [
  ["never", "Nunca"],
  ["propose", "Propor e esperar você"],
  ["auto", "Contratar sozinho"],
] as const;
const ENGAGEMENT = [
  ["job", "Só para o trabalho"],
  ["permanent", "Permanente"],
] as const;
const EDIT = [
  ["never", "Nunca"],
  ["propose", "Propor"],
  ["auto", "Sozinho"],
] as const;
const REMOVE = [
  ["never", "Nunca"],
  ["propose", "Propor"],
] as const;

export function AutonomyCard() {
  const queryClient = useQueryClient();
  const autonomy = useQuery({ queryKey: ["autonomy"], queryFn: agentsApi.autonomy });
  const catalog = useQuery({ queryKey: ["catalog"], queryFn: agentsApi.catalog });
  const [form, setForm] = useState<Autonomy | null>(null);
  useEffect(() => {
    if (autonomy.data && !form) setForm(autonomy.data);
  }, [autonomy.data, form]);
  const save = useMutation({
    mutationFn: () => agentsApi.saveAutonomy(form!),
    onSuccess: (saved) => {
      setForm(saved);
      queryClient.setQueryData(["autonomy"], saved);
    },
  });
  const set = <K extends keyof Autonomy>(key: K, value: Autonomy[K]) => {
    save.reset();
    setForm((f) => (f ? { ...f, [key]: value } : f));
  };
  const areas = catalog.data?.areas ?? [];
  const dirty = !!form && !!autonomy.data && JSON.stringify(form) !== JSON.stringify(autonomy.data);
  const toggleArea = (id: string) => {
    if (!form) return;
    const current = form.areas ?? areas.map((a) => a.id);
    const next = current.includes(id) ? current.filter((a) => a !== id) : [...current, id];
    set("areas", next.length === areas.length ? null : next);
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Alçadas do Chief of Staff</CardTitle>
        <CardDescription>
          O que o Chief decide sozinho sobre o time e o que ele propõe para você aprovar. Você continua podendo tudo pela tela de Agentes.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <ErrorNotice error={autonomy.error} />
        {!form ? (
          <LoadingRows rows={3} />
        ) : (
          <>
            <Field label="Trazer do catálogo um agente que falta para um pedido" hint={HINT[form.hire]}>
              <Segmented label="Trazer agente que falta" value={form.hire} options={HIRE} onChange={(v) => set("hire", v)} />
            </Field>
            <Field label="Quem o Chief traz entra" hint={form.engagement === "job" ? "Sai do time quando o trabalho termina; o histórico do que fez fica guardado." : "Fica no time depois do trabalho."}>
              <Segmented label="Tipo de contratação pelo Chief" value={form.engagement} options={ENGAGEMENT} onChange={(v) => set("engagement", v)} />
            </Field>
            <div className="grid gap-5 sm:grid-cols-2">
              <Field id="max-agents" label="Agentes por trabalho" hint="Quantos especialistas um mesmo trabalho pode envolver (1 a 12).">
                <Input
                  id="max-agents"
                  type="number"
                  min={1}
                  max={12}
                  className="w-24"
                  value={form.max_agents}
                  onChange={(e) => set("max_agents", Math.max(1, Math.min(12, Number(e.target.value) || 1)))}
                />
              </Field>
              <Field label="Áreas em que pode contratar" hint={form.areas === null ? "Todas as áreas do catálogo." : `${form.areas.length} de ${areas.length} áreas.`}>
                <div className="flex flex-wrap gap-1.5" role="group" aria-label="Áreas em que o Chief pode contratar">
                  {areas.map((a) => {
                    const on = form.areas === null || form.areas.includes(a.id);
                    return (
                      <button
                        key={a.id}
                        type="button"
                        aria-pressed={on}
                        onClick={() => toggleArea(a.id)}
                        className={cn("inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs", on ? "border-primary/40 bg-primary/10" : "text-muted-foreground")}
                      >
                        {on && <Check className="size-3" />} {a.title}
                      </button>
                    );
                  })}
                </div>
              </Field>
            </div>
            <div className="grid gap-5 sm:grid-cols-2">
              <Field label="Ajustar o time (orientações e a quem responde)" hint="Vale quando o Chief passar a revisar o time durante a execução.">
                <Segmented label="Ajustar o time" value={form.edit} options={EDIT} onChange={(v) => set("edit", v)} />
              </Field>
              <Field label="Tirar alguém do time" hint="Tirar quem é permanente sempre passa por você.">
                <Segmented label="Tirar do time" value={form.remove} options={REMOVE} onChange={(v) => set("remove", v)} />
              </Field>
            </div>
            <ErrorNotice error={save.error} title="Alçadas não salvas" />
            <div className="flex items-center gap-3">
              <Button disabled={!dirty || save.isPending} onClick={() => save.mutate()}>
                {save.isPending ? "Salvando…" : "Salvar alçadas"}
              </Button>
              {save.isSuccess && !dirty && <span className="text-sm text-muted-foreground">Salvo.</span>}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

const HINT: Record<Autonomy["hire"], string> = {
  never: "O Chief trabalha só com o time que você montou.",
  propose: "O Chief propõe na conversa quem trazer e por quê; nada muda no time sem o seu “contratar”.",
  auto: "O Chief traz quem falta dentro dos limites abaixo e avisa na conversa; tudo fica na trilha.",
};
