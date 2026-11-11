/**
 * Adicionar ao Cérebro: um arquivo (PDF, Word, TXT, Markdown, CSV, JSON) ou um texto escrito na
 * hora, com área, acesso, vigência e (opcional) a fonte que ele substitui.
 */
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FileUp, PenLine, Upload } from "lucide-react";
import { ErrorNotice } from "@/components/common";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { agentsApi, fileToBase64, knowledgeApi, type BrainArea, type FileFormat, type SourceSummary, type UploadInput } from "@/lib/api";
import { cn } from "@/lib/utils";
import { useAccess } from "../access/auth-gate";

const BY_EXTENSION: Record<string, string> = {
  md: "text/markdown",
  markdown: "text/markdown",
  csv: "text/csv",
  json: "application/json",
  txt: "text/plain",
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif",
};

/** Tipo pela extensão quando o navegador não informa (CSV e Markdown costumam vir vazios). */
export function mediaTypeOf(file: File) {
  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
  return BY_EXTENSION[ext] ?? (file.type || "application/octet-stream");
}

/** O `accept` do seletor de arquivos: as extensões que o Cérebro lê. */
export const acceptOf = (formats: FileFormat[]) =>
  (formats.length ? formats.flatMap((f) => f.extensions) : Object.keys(BY_EXTENSION)).map((e) => `.${e}`).join(",");

/** Pessoas leitoras, como entram no Aurora (e-mail em minúsculas). */
const people = (text: string) => text.split(",").map((r) => r.trim().toLowerCase()).filter(Boolean);

type Kind = "file" | "text";

export function UploadDialog({ sources, areas, formats, defaultArea }: { sources: SourceSummary[]; areas: BrainArea[]; formats: FileFormat[]; defaultArea?: string }) {
  const { mode } = useAccess();
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<Kind>("file");
  const [title, setTitle] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [text, setText] = useState("");
  const [area, setArea] = useState(defaultArea ?? "general");
  const [restricted, setRestricted] = useState(false);
  const [readers, setReaders] = useState("");
  const [agentReaders, setAgentReaders] = useState<string[]>([]);
  const team = useQuery({ queryKey: ["team"], queryFn: agentsApi.team });
  const [validFrom, setValidFrom] = useState("");
  const [supersedes, setSupersedes] = useState("");
  const queryClient = useQueryClient();
  const reset = () => {
    setTitle("");
    setFile(null);
    setText("");
    setReaders("");
    setRestricted(false);
    setAgentReaders([]);
    setValidFrom("");
    setSupersedes("");
  };
  const upload = useMutation({
    mutationFn: async () => {
      const common: UploadInput = {
        title: title.trim(),
        area,
        readers: restricted ? [...people(readers), ...agentReaders.map((id) => `agent:${id}`)] : undefined,
        valid_from: validFrom ? new Date(`${validFrom}T00:00:00`).toISOString() : undefined,
        supersedes: supersedes || null,
      };
      if (kind === "text") return knowledgeApi.upload({ ...common, text });
      const f = file!;
      return knowledgeApi.upload({ ...common, filename: f.name, media_type: mediaTypeOf(f), content_base64: await fileToBase64(f) });
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["sources"] });
      setOpen(false);
      reset();
      upload.reset();
    },
  });
  const replaceable = sources.filter((s) => s.status === "current");
  const content = kind === "file" ? !!file : !!text.trim();
  const ready = title.trim() && content && (!restricted || readers.trim() || agentReaders.length);
  const labels = formats.length ? formats.map((f) => f.label).join(", ") : "PDF, Word, TXT, MD, CSV, JSON";
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (o) setArea(defaultArea ?? "general");
      }}
    >
      <DialogTrigger asChild>
        <Button>
          <Upload /> Adicionar ao Cérebro
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Adicionar ao Cérebro</DialogTitle>
          <DialogDescription>Envie um arquivo ({labels}) ou escreva o texto aqui. Imagens (PNG, JPG, WEBP) são lidas uma vez pelo modelo, que transcreve o que está nelas (usa a sua cota). PDF escaneado não tem texto: envie como imagem.</DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-1 rounded-lg border p-1" role="tablist" aria-label="Tipo de conteúdo">
          {(
            [
              ["file", "Arquivo", FileUp],
              ["text", "Escrever texto", PenLine],
            ] as const
          ).map(([k, label, Icon]) => (
            <button
              key={k}
              type="button"
              role="tab"
              aria-selected={kind === k}
              onClick={() => setKind(k)}
              className={cn("inline-flex items-center justify-center gap-1.5 rounded-md px-2 py-1.5 text-sm", kind === k ? "bg-muted font-medium" : "text-muted-foreground hover:bg-muted/50")}
            >
              <Icon className="size-4" /> {label}
            </button>
          ))}
        </div>
        <form
          id="upload"
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (ready) upload.mutate();
          }}
        >
          {kind === "file" ? (
            <div className="space-y-2">
              <Label htmlFor="file">Arquivo</Label>
              <Input
                id="file"
                type="file"
                accept={acceptOf(formats)}
                onChange={(e) => {
                  const f = e.target.files?.[0] ?? null;
                  setFile(f);
                  if (f && !title) setTitle(f.name.replace(/\.[^.]+$/, ""));
                }}
              />
            </div>
          ) : (
            <div className="space-y-2">
              <Label htmlFor="text">Texto</Label>
              <Textarea
                id="text"
                rows={8}
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder={"# Política de reembolso\n\nDespesas acima de 500 reais precisam de nota fiscal e aprovação do gestor."}
              />
              <p className="text-xs text-muted-foreground">Pode usar Markdown: títulos com # viram seções e ajudam a busca a achar o trecho certo.</p>
            </div>
          )}
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="title">Título</Label>
              <Input id="title" value={title} maxLength={200} onChange={(e) => setTitle(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="area">Área</Label>
              <select id="area" className="h-9 w-full rounded-md border bg-transparent px-2 text-sm" value={area} onChange={(e) => setArea(e.target.value)}>
                {areas.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.title}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">Quem pode ler</legend>
            <label className="flex items-center gap-2 text-sm">
              <input type="radio" checked={!restricted} onChange={() => setRestricted(false)} /> Toda a empresa (os agentes também)
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input type="radio" checked={restricted} onChange={() => setRestricted(true)} /> Só estas pessoas e os agentes marcados
            </label>
            {restricted && (
              <div className="space-y-2">
                <Input aria-label="E-mails das pessoas que podem ler" placeholder="ana@empresa.com, caio@empresa.com" value={readers} onChange={(e) => setReaders(e.target.value)} />
                {mode === "accounts" && people(readers).some((r) => !r.includes("@")) && (
                  <p className="text-xs text-amber-700 dark:text-warning">Use o e-mail de cada pessoa, como ela entra no Aurora; um nome solto não dá acesso a ninguém.</p>
                )}
                {!!team.data?.agents.length && (
                  <div className="space-y-1 rounded-md border p-2">
                    <p className="text-xs text-muted-foreground">Agentes do time que também podem ler (os demais não veem esta fonte)</p>
                    {team.data.agents.map((a) => (
                      <label key={a.id} className="flex items-center gap-2 text-sm">
                        <input
                          type="checkbox"
                          checked={agentReaders.includes(a.id)}
                          onChange={(e) => setAgentReaders((list) => (e.target.checked ? [...list, a.id] : list.filter((x) => x !== a.id)))}
                        />
                        {a.name} · {a.title}
                      </label>
                    ))}
                  </div>
                )}
              </div>
            )}
          </fieldset>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="valid-from">Vale a partir de</Label>
              <Input id="valid-from" type="date" value={validFrom} onChange={(e) => setValidFrom(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="supersedes">Substitui</Label>
              <select id="supersedes" className="h-9 w-full rounded-md border bg-transparent px-2 text-sm" value={supersedes} onChange={(e) => setSupersedes(e.target.value)}>
                <option value="">Nenhuma</option>
                {replaceable.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.title}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <ErrorNotice error={upload.error} title="Não foi adicionado" />
        </form>
        <DialogFooter>
          <Button type="submit" form="upload" disabled={!ready || upload.isPending}>
            {upload.isPending ? "Lendo e guardando…" : "Adicionar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
