/** Enviar uma fonte nova ao Cérebro, com acesso, vigência e (opcional) a fonte que ela substitui. */
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Upload } from "lucide-react";
import { ErrorNotice } from "@/components/common";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { agentsApi, fileToBase64, knowledgeApi, type SourceSummary } from "@/lib/api";

/** Tipo pelo nome quando o navegador não informa (CSV e Markdown costumam vir vazios). */
export function mediaTypeOf(file: File) {
  const ext = file.name.split(".").pop()?.toLowerCase();
  if (ext === "md" || ext === "markdown") return "text/markdown";
  if (ext === "csv") return "text/csv";
  if (ext === "json") return "application/json";
  if (ext === "txt") return "text/plain";
  return file.type || "application/octet-stream";
}

export function UploadDialog({ sources, mediaTypes }: { sources: SourceSummary[]; mediaTypes: string[] }) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [restricted, setRestricted] = useState(false);
  const [readers, setReaders] = useState("");
  const [agentReaders, setAgentReaders] = useState<string[]>([]);
  const team = useQuery({ queryKey: ["team"], queryFn: agentsApi.team });
  const [validFrom, setValidFrom] = useState("");
  const [supersedes, setSupersedes] = useState("");
  const queryClient = useQueryClient();
  const upload = useMutation({
    mutationFn: async () => {
      const f = file!;
      return knowledgeApi.upload({
        title: title.trim(),
        filename: f.name,
        media_type: mediaTypeOf(f),
        content_base64: await fileToBase64(f),
        readers: restricted ? [...readers.split(",").map((r) => r.trim()).filter(Boolean), ...agentReaders.map((id) => `agent:${id}`)] : undefined,
        valid_from: validFrom ? new Date(`${validFrom}T00:00:00`).toISOString() : undefined,
        supersedes: supersedes || null,
      });
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["sources"] });
      setOpen(false);
      setTitle("");
      setFile(null);
      setReaders("");
      setRestricted(false);
      setAgentReaders([]);
      setValidFrom("");
      setSupersedes("");
      upload.reset();
    },
  });
  const replaceable = sources.filter((s) => s.status === "current");
  const ready = title.trim() && file && (!restricted || readers.trim() || agentReaders.length);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <Upload /> Enviar fonte
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Enviar fonte ao Cérebro</DialogTitle>
          <DialogDescription>Aceitos: {mediaTypes.length ? mediaTypes.join(", ") : "texto, Markdown, CSV e JSON"} (UTF-8).</DialogDescription>
        </DialogHeader>
        <form
          id="upload"
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (ready) upload.mutate();
          }}
        >
          <div className="space-y-2">
            <Label htmlFor="file">Arquivo</Label>
            <Input
              id="file"
              type="file"
              accept=".txt,.md,.markdown,.csv,.json,text/plain,text/markdown,text/csv,application/json"
              onChange={(e) => {
                const f = e.target.files?.[0] ?? null;
                setFile(f);
                if (f && !title) setTitle(f.name.replace(/\.[^.]+$/, ""));
              }}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="title">Título</Label>
            <Input id="title" value={title} maxLength={200} onChange={(e) => setTitle(e.target.value)} />
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
                <Input aria-label="Pessoas que podem ler" placeholder="ana, caio" value={readers} onChange={(e) => setReaders(e.target.value)} />
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
          <ErrorNotice error={upload.error} title="Fonte não enviada" />
        </form>
        <DialogFooter>
          <Button type="submit" form="upload" disabled={!ready || upload.isPending}>
            {upload.isPending ? "Enviando…" : "Enviar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
