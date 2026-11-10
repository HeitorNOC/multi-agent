/** Dados da empresa: usado em Configurações e no primeiro passo de "Montar sua empresa". */
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ErrorNotice } from "@/components/common";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { companyApi } from "@/lib/api";

export function CompanyForm({ onSaved, submitLabel = "Salvar" }: { onSaved?: () => void; submitLabel?: string }) {
  const queryClient = useQueryClient();
  const company = useQuery({ queryKey: ["organization"], queryFn: companyApi.get });
  const [form, setForm] = useState({ name: "", sector: "", objectives: "", policies: "" });
  useEffect(() => {
    if (company.data) setForm({ name: company.data.name, sector: company.data.sector, objectives: company.data.objectives, policies: company.data.policies });
  }, [company.data]);
  const save = useMutation({
    mutationFn: () => companyApi.save(form),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["organization"] });
      void queryClient.invalidateQueries({ queryKey: ["setup"] });
      void queryClient.invalidateQueries({ queryKey: ["organogram"] });
      onSaved?.();
    },
  });
  const set = (key: keyof typeof form) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [key]: e.target.value }));
  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (form.name.trim().length >= 2) save.mutate();
      }}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="c-name">Nome da empresa</Label>
          <Input id="c-name" maxLength={120} value={form.name} onChange={set("name")} placeholder="Comercial Horizonte" />
        </div>
        <div className="space-y-2">
          <Label htmlFor="c-sector">Setor</Label>
          <Input id="c-sector" maxLength={120} value={form.sector} onChange={set("sector")} placeholder="Varejo de materiais de construção" />
        </div>
      </div>
      <div className="space-y-2">
        <Label htmlFor="c-objectives">Objetivos</Label>
        <Textarea id="c-objectives" rows={3} maxLength={2000} value={form.objectives} onChange={set("objectives")} placeholder="O que a empresa quer alcançar neste ano." />
      </div>
      <div className="space-y-2">
        <Label htmlFor="c-policies">Políticas gerais</Label>
        <Textarea id="c-policies" rows={3} maxLength={4000} value={form.policies} onChange={set("policies")} placeholder="Regras que valem para todos (aprovação, comunicação, sigilo)." />
        <p className="text-xs text-muted-foreground">Políticas detalhadas vão para o Cérebro como documentos, para os agentes poderem citá-las.</p>
      </div>
      <ErrorNotice error={save.error} title="Empresa não salva" />
      <Button type="submit" disabled={form.name.trim().length < 2 || save.isPending}>
        {save.isPending ? "Salvando…" : submitLabel}
      </Button>
    </form>
  );
}
