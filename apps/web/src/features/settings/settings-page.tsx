/** Configurações: dados da empresa (editáveis) e como esta instalação está rodando (só leitura). */
import { useQuery } from "@tanstack/react-query";
import { ErrorNotice, PageHeader, ToneBadge } from "@/components/common";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { companyApi } from "@/lib/api";
import { formatBytes } from "@/lib/format";
import { CompanyForm } from "./company-form";

const PROVIDER = { none: "Nenhum (respostas extraídas dos trechos)", claude: "Claude Code (CLI local)", codex: "Codex (CLI local)" };

export function SettingsPage() {
  const settings = useQuery({ queryKey: ["settings"], queryFn: companyApi.settings });
  const s = settings.data;
  return (
    <div className="space-y-6">
      <PageHeader title="Configurações" />
      <Card>
        <CardHeader>
          <CardTitle>Empresa</CardTitle>
        </CardHeader>
        <CardContent>
          <CompanyForm />
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Instalação</CardTitle>
          <CardDescription>Definida nas variáveis AURORA_* ao subir a API. O Aurora usa a conta já aberta na CLI deste computador e nunca guarda credenciais.</CardDescription>
        </CardHeader>
        <CardContent>
          <ErrorNotice error={settings.error} />
          {s && (
            <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-[220px_1fr]">
              <dt className="text-muted-foreground">Modelo</dt>
              <dd className="flex flex-wrap items-center gap-2">
                {PROVIDER[s.model.provider]}
                {s.model.name && <span className="text-muted-foreground">({s.model.name})</span>}
              </dd>
              <dt className="text-muted-foreground">Chief of Staff na conversa</dt>
              <dd>{s.chief_engine === "model" ? "Modelo, com volta às regras se falhar" : "Regras"}</dd>
              <dt className="text-muted-foreground">Respostas do Cérebro</dt>
              <dd>{s.knowledge_answerer === "model" ? "Redigidas pelo modelo, com volta ao extrativo" : "Trechos extraídos"}</dd>
              <dt className="text-muted-foreground">Tamanho máximo de arquivo</dt>
              <dd>{formatBytes(s.knowledge_max_bytes)}</dd>
              <dt className="text-muted-foreground">Banco</dt>
              <dd>{s.database === "postgres" ? "PostgreSQL" : "SQLite"}</dd>
              <dt className="text-muted-foreground">Worker dos especialistas</dt>
              <dd>
                {s.worker.configured ? <ToneBadge tone="success">Configurado</ToneBadge> : <ToneBadge tone="warning">Não configurado: pedidos ficam na fila</ToneBadge>}
              </dd>
              <dt className="text-muted-foreground">Fila</dt>
              <dd>
                {s.queue.capacity} vagas ({s.queue.resumeReserve} reservadas para retomadas) · {s.queue.maxWorkers} execução(ões) por vez
              </dd>
            </dl>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
