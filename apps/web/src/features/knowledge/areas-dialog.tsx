/**
 * Áreas do Cérebro: criar, renomear e excluir as da empresa. "Geral" e as do catálogo de agentes
 * são fixas; uma área só sai quando não tem fonte em vigor.
 */
import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Check, FolderTree, Pencil, Plus, Trash2, X } from "lucide-react";
import { ConfirmAction, ErrorNotice, ToneBadge } from "@/components/common";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { knowledgeApi, type BrainArea } from "@/lib/api";

const MAX = 60;

function useRefreshSources() {
  const queryClient = useQueryClient();
  return () => void queryClient.invalidateQueries({ queryKey: ["sources"] });
}

/**
 * Campo "Nome da nova área" + Criar, usado no gerenciador e dentro de outros formulários (por isso
 * não é um `<form>`: formulário dentro de formulário não vale em HTML; o Enter é tratado à mão).
 */
export function NewAreaForm({ onCreated, onCancel, autoFocus }: { onCreated?: (area: BrainArea) => void; onCancel?: () => void; autoFocus?: boolean }) {
  const refresh = useRefreshSources();
  const [title, setTitle] = useState("");
  const create = useMutation({
    mutationFn: () => knowledgeApi.createArea(title.trim()),
    onSuccess: (area) => {
      setTitle("");
      refresh();
      onCreated?.(area);
    },
  });
  const submit = () => {
    if (title.trim() && !create.isPending) create.mutate();
  };
  return (
    <div className="space-y-2">
      <div className="flex gap-2">
        <Input
          aria-label="Nome da nova área"
          placeholder="Ex.: Jurídico, Comercial, Operações"
          maxLength={MAX}
          value={title}
          autoFocus={autoFocus}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              submit();
            }
            if (e.key === "Escape" && onCancel) {
              e.preventDefault();
              e.stopPropagation();
              onCancel();
            }
          }}
        />
        <Button type="button" disabled={!title.trim() || create.isPending} onClick={submit}>
          <Plus /> {create.isPending ? "Criando…" : "Criar"}
        </Button>
        {onCancel && (
          <Button type="button" variant="ghost" size="icon" aria-label="Cancelar nova área" onClick={onCancel}>
            <X />
          </Button>
        )}
      </div>
      <ErrorNotice error={create.error} title="Área não criada" />
    </div>
  );
}

export function AreasDialog({ areas }: { areas: BrainArea[] }) {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="outline">
          <FolderTree /> Áreas
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Áreas do Cérebro</DialogTitle>
          <DialogDescription>
            Organize as fontes por área da empresa. “Geral” e as áreas dos agentes são fixas; as criadas aqui podem ser renomeadas e excluídas.
          </DialogDescription>
        </DialogHeader>
        <NewAreaForm />
        {(
          [
            ["Criadas pela empresa", areas.filter((a) => a.custom), "Nenhuma ainda. Crie acima a primeira."],
            ["Fixas", areas.filter((a) => !a.custom), ""],
          ] as const
        ).map(([title, list, empty]) => (
          <section key={title} className="space-y-2">
            <h3 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
              {title} <span className="font-normal">· {list.length}</span>
            </h3>
            {list.length ? (
              <ul className="divide-y rounded-lg border">
                {list.map((a) => (
                  <AreaRow key={a.id} area={a} />
                ))}
              </ul>
            ) : (
              <p className="rounded-lg border border-dashed p-3 text-sm text-muted-foreground">{empty}</p>
            )}
          </section>
        ))}
      </DialogContent>
    </Dialog>
  );
}

function AreaRow({ area }: { area: BrainArea }) {
  const refresh = useRefreshSources();
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(area.title);
  const rename = useMutation({
    mutationFn: () => knowledgeApi.renameArea(area.id, title.trim()),
    onSuccess: () => {
      setEditing(false);
      refresh();
    },
  });
  const remove = useMutation({ mutationFn: () => knowledgeApi.removeArea(area.id), onSuccess: refresh });
  const count = `${area.sources} fonte${area.sources === 1 ? "" : "s"}`;
  if (editing)
    return (
      <li className="space-y-2 p-3">
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (title.trim() && title.trim() !== area.title) rename.mutate();
            else setEditing(false);
          }}
        >
          <Input aria-label={`Novo nome de ${area.title}`} maxLength={MAX} value={title} autoFocus onChange={(e) => setTitle(e.target.value)} />
          <Button type="submit" size="icon" aria-label="Salvar nome" disabled={!title.trim() || rename.isPending}>
            <Check />
          </Button>
          <Button
            type="button"
            size="icon"
            variant="ghost"
            aria-label="Cancelar"
            onClick={() => {
              setTitle(area.title);
              setEditing(false);
              rename.reset();
            }}
          >
            <X />
          </Button>
        </form>
        <ErrorNotice error={rename.error} title="Nome não alterado" />
      </li>
    );
  return (
    <li className="space-y-2 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">{area.title}</p>
          <p className="text-xs text-muted-foreground">{count}</p>
        </div>
        {area.custom ? (
          <>
            <Button variant="ghost" size="sm" onClick={() => setEditing(true)}>
              <Pencil /> Renomear
            </Button>
            {area.sources > 0 ? (
              <span className="px-2 text-xs text-muted-foreground" title="Mova as fontes para outra área antes de excluir">
                Em uso
              </span>
            ) : (
              <ConfirmAction variant="ghost" icon={<Trash2 />} label="Excluir" confirmLabel="Excluir área" pending={remove.isPending} onConfirm={() => remove.mutate()} />
            )}
          </>
        ) : (
          <ToneBadge tone="neutral">Fixa</ToneBadge>
        )}
      </div>
      <ErrorNotice error={remove.error} title="Área não excluída" />
    </li>
  );
}
