/**
 * "Montar sua empresa": primeiro uso em quatro passos — Empresa, Cérebro, Time e Organograma.
 * Cada passo grava de verdade; dá para sair e voltar.
 */
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, ArrowRight, Check } from "lucide-react";
import { Link, useNavigate } from "react-router";
import { ErrorNotice, PageHeader } from "@/components/common";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { agentsApi, companyApi, knowledgeApi } from "@/lib/api";
import { cn } from "@/lib/utils";
import { Catalog } from "../agents/agents-page";
import { UploadDialog } from "../knowledge/upload-dialog";
import { OrganogramPage } from "../organogram/organogram-page";
import { CompanyForm } from "../settings/company-form";

const STEPS = [
  { id: "company", title: "Empresa", text: "Nome, setor, objetivos e políticas gerais." },
  { id: "knowledge", title: "Cérebro", text: "Os primeiros documentos que os agentes vão citar." },
  { id: "team", title: "Time", text: "Os especialistas que o Chief of Staff pode escalar." },
  { id: "org", title: "Organograma", text: "Quem responde a quem." },
] as const;

export function SetupPage() {
  const [step, setStep] = useState(0);
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const status = useQuery({ queryKey: ["setup"], queryFn: companyApi.setup });
  const done = (id: (typeof STEPS)[number]["id"]) => (id === "org" ? false : (status.data?.steps[id] ?? false));
  const complete = useMutation({
    mutationFn: companyApi.completeSetup,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["setup"] });
      void navigate("/");
    },
  });
  const current = STEPS[step]!;
  return (
    <div className="space-y-6">
      <PageHeader title="Montar sua empresa" description="Quatro passos para o Chief of Staff e o time começarem a trabalhar com o que é da sua empresa." />
      <ol className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {STEPS.map((s, i) => (
          <li key={s.id}>
            <button
              type="button"
              onClick={() => setStep(i)}
              className={cn("flex w-full items-center gap-2 rounded-lg border p-3 text-left text-sm", i === step && "border-primary bg-muted")}
              aria-current={i === step ? "step" : undefined}
            >
              <span className={cn("flex size-6 shrink-0 items-center justify-center rounded-full text-xs", done(s.id) ? "bg-success text-white" : "bg-muted-foreground/20")}>
                {done(s.id) ? <Check className="size-3.5" /> : i + 1}
              </span>
              {s.title}
            </button>
          </li>
        ))}
      </ol>
      <Card>
        <CardHeader>
          <CardTitle>
            {step + 1}. {current.title}
          </CardTitle>
          <CardDescription>{current.text}</CardDescription>
        </CardHeader>
        <CardContent>
          {current.id === "company" && <CompanyForm submitLabel="Salvar e continuar" onSaved={() => setStep(1)} />}
          {current.id === "knowledge" && <KnowledgeStep />}
          {current.id === "team" && <TeamStep />}
          {current.id === "org" && <OrganogramPage />}
        </CardContent>
      </Card>
      <ErrorNotice error={complete.error} title="Ainda falta um passo" />
      <div className="flex flex-wrap justify-between gap-2">
        <Button variant="ghost" disabled={step === 0} onClick={() => setStep(step - 1)}>
          <ArrowLeft /> Voltar
        </Button>
        {step < STEPS.length - 1 ? (
          <Button variant="outline" onClick={() => setStep(step + 1)}>
            Próximo <ArrowRight />
          </Button>
        ) : (
          <Button disabled={complete.isPending} onClick={() => complete.mutate()}>
            <Check /> Concluir
          </Button>
        )}
      </div>
    </div>
  );
}

function KnowledgeStep() {
  const sources = useQuery({ queryKey: ["sources"], queryFn: knowledgeApi.list });
  const list = sources.data?.sources ?? [];
  return (
    <div className="space-y-4 text-sm">
      <p>Envie políticas, procedimentos, tabelas de preço ou contratos-modelo. Eu leio, divido em trechos e os agentes citam a fonte e a versão em cada afirmação.</p>
      <UploadDialog sources={list} mediaTypes={sources.data?.media_types ?? []} />
      {list.length > 0 ? (
        <ul className="list-disc space-y-1 pl-5 text-muted-foreground">
          {list.map((s) => (
            <li key={s.id}>{s.title}</li>
          ))}
        </ul>
      ) : (
        <p className="text-muted-foreground">Pode deixar para depois: sem fontes, os pareceres se abstêm em vez de inventar.</p>
      )}
      <Link to="/cerebro" className="text-xs underline">
        Abrir o Cérebro completo
      </Link>
    </div>
  );
}

function TeamStep() {
  const catalog = useQuery({ queryKey: ["catalog"], queryFn: agentsApi.catalog });
  return catalog.data ? <Catalog areas={catalog.data.areas} compact /> : <ErrorNotice error={catalog.error} />;
}
