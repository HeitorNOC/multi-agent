/**
 * Recursos da empresa (N6): o que você já provisionou para o time usar — bancos, filas, ambientes,
 * repositórios, nuvem. O Chief planeja com eles e avisa o que falta. Só descrições: credenciais
 * vão nos conectores, cifradas.
 */
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Trash2 } from "lucide-react";
import { ConfirmAction, EmptyState, ErrorNotice, LoadingRows } from "@/components/common";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { resourcesApi } from "@/lib/api";

const KIND: Record<string, string> = { database: "Banco de dados", queue: "Fila / mensageria", environment: "Ambiente", repository: "Repositório", cloud: "Nuvem", other: "Outro" };

export function ResourcesCard() {
  const queryClient = useQueryClient();
  const list = useQuery({ queryKey: ["resources"], queryFn: resourcesApi.list });
  const [kind, setKind] = useState("queue");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const refresh = () => void queryClient.invalidateQueries({ queryKey: ["resources"] });
  const add = useMutation({
    mutationFn: () => resourcesApi.add(kind, name.trim(), description.trim()),
    onSuccess: () => {
      setName("");
      setDescription("");
      refresh();
    },
  });
  return (
    <Card>
      <CardHeader>
        <CardTitle>Recursos da empresa</CardTitle>
        <CardDescription>
          O que o time pode usar: bancos, filas (Kafka), ambientes, repositórios, nuvem. O Chief of Staff planeja com eles e avisa o que falta provisionar. Não coloque senhas aqui: credenciais vão nos
          conectores, cifradas.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <ErrorNotice error={list.error} />
        <form
          className="grid gap-2 sm:grid-cols-[10rem_1fr]"
          onSubmit={(e) => {
            e.preventDefault();
            add.mutate();
          }}
        >
          <NativeSelect aria-label="Tipo do recurso" value={kind} onChange={(e) => setKind(e.target.value)}>
            {Object.entries(KIND).map(([k, label]) => (
              <option key={k} value={k}>
                {label}
              </option>
            ))}
          </NativeSelect>
          <Input aria-label="Nome do recurso" maxLength={80} value={name} onChange={(e) => setName(e.target.value)} placeholder="Ex.: Kafka de produção" />
          <Textarea
            aria-label="Descrição do recurso"
            className="sm:col-span-2"
            rows={2}
            maxLength={1000}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Ex.: Cluster kafka.interno:9092; tópicos atendimento.*; times de TI podem criar tópicos novos com aprovação."
          />
          <div className="sm:col-span-2">
            <Button type="submit" disabled={name.trim().length < 2 || description.trim().length < 5 || add.isPending}>
              <Plus /> Adicionar recurso
            </Button>
          </div>
        </form>
        <ErrorNotice error={add.error} title="Recurso não adicionado" />
        {list.isPending ? (
          <LoadingRows rows={2} />
        ) : !list.data?.resources.length ? (
          <EmptyState title="Nenhum recurso cadastrado">Cadastre o que já existe (banco, fila, ambiente) para o Chief planejar com o que a empresa tem.</EmptyState>
        ) : (
          <ul className="divide-y rounded-lg border" aria-label="Recursos cadastrados">
            {list.data.resources.map((r) => (
              <ResourceRow key={r.id} id={r.id} kind={r.kind} name={r.name} description={r.description} onChange={refresh} />
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function ResourceRow({ id, kind, name, description, onChange }: { id: string; kind: string; name: string; description: string; onChange: () => void }) {
  const remove = useMutation({ mutationFn: () => resourcesApi.remove(id), onSuccess: onChange });
  return (
    <li className="flex items-start gap-3 p-3 text-sm">
      <div className="min-w-0 flex-1">
        <p className="font-medium">
          {name} <span className="text-xs font-normal text-muted-foreground">· {KIND[kind] ?? kind}</span>
        </p>
        <p className="text-xs text-muted-foreground">{description}</p>
      </div>
      <ConfirmAction icon={<Trash2 />} label="Remover" confirmLabel="Remover recurso" pending={remove.isPending} onConfirm={() => remove.mutate()} />
    </li>
  );
}
