/**
 * Memória da empresa (N5): fatos que o Chief e todos os agentes recebem em cada tarefa — o que a
 * empresa vende, para quem, o tom da marca, a stack, regras do negócio.
 */
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { ConfirmAction, EmptyState, ErrorNotice, LoadingRows } from "@/components/common";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { factsApi, type CompanyFact } from "@/lib/api";

const LABEL: Record<string, string> = { empresa: "Empresa", produtos: "Produtos", clientes: "Clientes", marca: "Marca", tecnologia: "Tecnologia", regras: "Regras" };

export function FactsCard() {
  const queryClient = useQueryClient();
  const facts = useQuery({ queryKey: ["facts"], queryFn: factsApi.list });
  const [text, setText] = useState("");
  const [category, setCategory] = useState("empresa");
  const refresh = () => void queryClient.invalidateQueries({ queryKey: ["facts"] });
  const add = useMutation({
    mutationFn: () => factsApi.add(text.trim(), category),
    onSuccess: () => {
      setText("");
      refresh();
    },
  });
  const categories = facts.data?.categories ?? Object.keys(LABEL);
  return (
    <Card>
      <CardHeader>
        <CardTitle>Memória da empresa</CardTitle>
        <CardDescription>Fatos que o Chief of Staff e todos os agentes recebem em cada tarefa: o que a empresa vende, para quem, o tom da marca, a tecnologia, as regras do negócio.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <ErrorNotice error={facts.error} />
        <form
          className="flex flex-wrap items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (text.trim().length >= 3) add.mutate();
          }}
        >
          <NativeSelect aria-label="Categoria do fato" className="w-36" value={category} onChange={(e) => setCategory(e.target.value)}>
            {categories.map((c) => (
              <option key={c} value={c}>
                {LABEL[c] ?? c}
              </option>
            ))}
          </NativeSelect>
          <Input aria-label="Novo fato" className="min-w-0 flex-1" maxLength={500} value={text} onChange={(e) => setText(e.target.value)} placeholder="Ex.: Vendemos materiais de construção para pequenas obras." />
          <Button type="submit" disabled={text.trim().length < 3 || add.isPending}>
            <Plus /> Adicionar
          </Button>
        </form>
        <ErrorNotice error={add.error} title="Fato não adicionado" />
        {facts.isPending ? (
          <LoadingRows rows={2} />
        ) : !facts.data?.facts.length ? (
          <EmptyState title="Nenhum fato ainda">Comece pelo que todo funcionário novo precisa saber no primeiro dia.</EmptyState>
        ) : (
          <ul className="divide-y rounded-lg border" aria-label="Fatos da empresa">
            {facts.data.facts.map((f) => (
              <FactRow key={f.id} fact={f} categories={categories} onChange={refresh} />
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function FactRow({ fact, categories, onChange }: { fact: CompanyFact; categories: string[]; onChange: () => void }) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(fact.text);
  const [category, setCategory] = useState(fact.category);
  const save = useMutation({ mutationFn: () => factsApi.change(fact.id, text.trim(), category), onSuccess: () => (setEditing(false), onChange()) });
  const remove = useMutation({ mutationFn: () => factsApi.remove(fact.id), onSuccess: onChange });
  if (editing)
    return (
      <li className="flex flex-wrap items-center gap-2 p-2">
        <NativeSelect aria-label={`Categoria de ${fact.text}`} className="w-36" value={category} onChange={(e) => setCategory(e.target.value)}>
          {categories.map((c) => (
            <option key={c} value={c}>
              {LABEL[c] ?? c}
            </option>
          ))}
        </NativeSelect>
        <Input aria-label="Texto do fato" className="min-w-0 flex-1" maxLength={500} value={text} onChange={(e) => setText(e.target.value)} />
        <Button size="sm" disabled={text.trim().length < 3 || save.isPending} onClick={() => save.mutate()}>
          Salvar
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>
          Cancelar
        </Button>
        <ErrorNotice error={save.error} />
      </li>
    );
  return (
    <li className="flex items-center gap-2 p-2 text-sm">
      <span className="w-24 shrink-0 text-xs font-medium uppercase tracking-wide text-muted-foreground">{LABEL[fact.category] ?? fact.category}</span>
      <span className="min-w-0 flex-1">{fact.text}</span>
      <Button size="sm" variant="ghost" aria-label={`Editar ${fact.text}`} onClick={() => setEditing(true)}>
        <Pencil />
      </Button>
      <ConfirmAction icon={<Trash2 />} label="Remover" confirmLabel="Remover fato" pending={remove.isPending} onConfirm={() => remove.mutate()} />
    </li>
  );
}
