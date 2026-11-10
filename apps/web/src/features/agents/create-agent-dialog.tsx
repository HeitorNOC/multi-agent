/** "Criar meu agente": um especialista do zero, com área, foco, habilidades e orientações. */
import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { UserPlus } from "lucide-react";
import { ErrorNotice } from "@/components/common";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { agentsApi, type CatalogArea } from "@/lib/api";

const EMPTY = { name: "", title: "", area: "", focus: "", tagline: "", skills: "", instructions: "" };

export function CreateAgentDialog({ areas }: { areas: { id: string; title: string }[] | CatalogArea[] }) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(EMPTY);
  const queryClient = useQueryClient();
  const set = (key: keyof typeof EMPTY) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [key]: e.target.value }));
  const create = useMutation({
    mutationFn: () =>
      agentsApi.create({
        name: form.name.trim(),
        title: form.title.trim(),
        area: form.area,
        focus: form.focus.trim(),
        tagline: form.tagline.trim() || undefined,
        skills: form.skills.split(",").map((s) => s.trim()).filter(Boolean),
        instructions: form.instructions.trim() || undefined,
      }),
    onSuccess: () => {
      for (const key of ["team", "organogram", "setup", "catalog"]) void queryClient.invalidateQueries({ queryKey: [key] });
      setForm(EMPTY);
      setOpen(false);
      create.reset();
    },
  });
  const ready = form.name.trim() && form.title.trim() && form.area && form.focus.trim();
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline">
          <UserPlus /> Criar meu agente
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Criar meu agente</DialogTitle>
          <DialogDescription>Ele entra no seu time e segue as mesmas regras: só fontes do Cérebro, sempre citadas.</DialogDescription>
        </DialogHeader>
        <form
          id="create-agent"
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (ready) create.mutate();
          }}
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="a-name">Nome</Label>
              <Input id="a-name" maxLength={60} value={form.name} onChange={set("name")} placeholder="Rita" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="a-title">Cargo</Label>
              <Input id="a-title" maxLength={100} value={form.title} onChange={set("title")} placeholder="Analista fiscal" />
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="a-area">Área</Label>
            <select id="a-area" className="h-9 w-full rounded-md border bg-transparent px-2 text-sm" value={form.area} onChange={set("area")}>
              <option value="">Escolha…</option>
              {areas.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.title}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="a-focus">No que ajuda</Label>
            <Textarea id="a-focus" maxLength={400} rows={2} value={form.focus} onChange={set("focus")} placeholder="Tributos, obrigações acessórias e prazos fiscais" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="a-tagline">Frase (opcional)</Label>
            <Input id="a-tagline" maxLength={160} value={form.tagline} onChange={set("tagline")} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="a-skills">Habilidades (separadas por vírgula)</Label>
            <Input id="a-skills" value={form.skills} onChange={set("skills")} placeholder="Apuração de impostos, SPED, Prazos" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="a-instructions">Orientações (opcional)</Label>
            <Textarea id="a-instructions" maxLength={1500} rows={3} value={form.instructions} onChange={set("instructions")} placeholder="Ex.: Sempre indique a norma aplicável." />
          </div>
          <ErrorNotice error={create.error} title="Agente não criado" />
        </form>
        <DialogFooter>
          <Button type="submit" form="create-agent" disabled={!ready || create.isPending}>
            {create.isPending ? "Criando…" : "Criar e colocar no time"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
