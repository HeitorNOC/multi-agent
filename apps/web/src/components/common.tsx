/** Peças pequenas usadas por todas as áreas: selo, cabeçalhos, vazio, erro, campo e confirmação. */
import { useState, type ReactNode } from "react";
import { AlertCircle, WifiOff } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { ApiError, OFFLINE } from "@/lib/api";
import type { Tone } from "@/lib/format";
import { cn } from "@/lib/utils";

const TONE: Record<Tone, string> = {
  neutral: "bg-muted text-muted-foreground",
  info: "bg-sky-500/15 text-sky-700 dark:text-sky-300",
  success: "bg-success/15 text-success",
  warning: "bg-warning/15 text-amber-700 dark:text-warning",
  danger: "bg-destructive/15 text-destructive",
};

export function ToneBadge({ tone, children, className }: { tone: Tone; children: ReactNode; className?: string }) {
  return <Badge className={cn("border-transparent", TONE[tone], className)}>{children}</Badge>;
}

export function PageHeader({ title, description, actions }: { title: string; description?: string; actions?: ReactNode }) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {description && <p className="mt-1 text-sm text-muted-foreground">{description}</p>}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

export function EmptyState({ icon, title, children }: { icon?: ReactNode; title: string; children?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed p-10 text-center">
      {icon && <div className="text-muted-foreground [&>svg]:size-8">{icon}</div>}
      <p className="font-medium">{title}</p>
      {children && <div className="max-w-md text-sm text-muted-foreground">{children}</div>}
    </div>
  );
}

/** Mostra a mensagem da API (já em português) ou uma genérica. */
export function ErrorNotice({ error, title = "Não foi possível concluir" }: { error: unknown; title?: string }) {
  if (!error) return null;
  const message = error instanceof ApiError || error instanceof Error ? error.message : "Erro inesperado";
  if (error instanceof ApiError && error.code === OFFLINE)
    return (
      <Alert>
        <WifiOff />
        <AlertTitle>Sem conexão com o Aurora</AlertTitle>
        <AlertDescription>{message}</AlertDescription>
      </Alert>
    );
  return (
    <Alert variant="destructive">
      <AlertCircle />
      <AlertTitle>{title}</AlertTitle>
      <AlertDescription>{message}</AlertDescription>
    </Alert>
  );
}

export function LoadingRows({ rows = 3 }: { rows?: number }) {
  return (
    <div className="space-y-3">
      {Array.from({ length: rows }, (_, i) => (
        <Skeleton key={i} className="h-16 w-full" />
      ))}
    </div>
  );
}

/** Rótulo, campo e uma dica opcional embaixo: o mesmo desenho em todo formulário. */
export function Field({ id, label, hint, children, className }: { id?: string; label: ReactNode; hint?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <div className={cn("space-y-2", className)}>
      <Label htmlFor={id}>{label}</Label>
      {children}
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

/** Ação que não se desfaz: o primeiro clique pede confirmação, o segundo executa. */
export function ConfirmAction({
  label,
  confirmLabel,
  onConfirm,
  pending,
  icon,
  size = "sm",
  variant = "outline",
}: {
  label: string;
  confirmLabel: string;
  onConfirm: () => void;
  pending?: boolean;
  icon?: ReactNode;
  size?: "sm" | "default";
  variant?: "outline" | "ghost";
}) {
  const [asking, setAsking] = useState(false);
  if (!asking)
    return (
      <Button type="button" variant={variant} size={size} className="text-destructive hover:text-destructive" onClick={() => setAsking(true)}>
        {icon} {label}
      </Button>
    );
  return (
    <div className="flex flex-wrap gap-2">
      <Button type="button" variant="ghost" size={size} onClick={() => setAsking(false)}>
        Cancelar
      </Button>
      <Button type="button" variant="destructive" size={size} disabled={pending} onClick={onConfirm}>
        {pending ? "Aguarde…" : confirmLabel}
      </Button>
    </div>
  );
}

/** Caixa no fim de um detalhe com a ação destrutiva e o que ela causa. */
export function DangerZone({ children, action }: { children: ReactNode; action: ReactNode }) {
  return (
    <div className="flex flex-col gap-3 rounded-lg border border-destructive/30 bg-destructive/5 p-3 sm:flex-row sm:items-center">
      <p className="min-w-0 flex-1 text-sm text-muted-foreground">{children}</p>
      <div className="shrink-0">{action}</div>
    </div>
  );
}

/** Alternância entre poucas opções (Lista / Mapa, Diária / Intervalo…). */
export function Segmented<T extends string | boolean>({
  value,
  options,
  onChange,
  label,
  className,
}: {
  value: T;
  options: readonly (readonly [T, ReactNode])[];
  onChange: (value: T) => void;
  label: string;
  className?: string;
}) {
  return (
    <div className={cn("inline-flex rounded-lg border bg-muted/40 p-0.5", className)} role="radiogroup" aria-label={label}>
      {options.map(([v, text]) => (
        <button
          key={String(v)}
          type="button"
          role="radio"
          aria-checked={value === v}
          onClick={() => onChange(v)}
          className={cn(
            "rounded-md px-3 py-1 text-sm transition-colors",
            value === v ? "bg-background font-medium shadow-xs dark:bg-input/50" : "text-muted-foreground hover:text-foreground",
          )}
        >
          {text}
        </button>
      ))}
    </div>
  );
}

/** Título de uma seção dentro da página, com ações opcionais à direita. */
export function SectionHeader({ title, description, actions }: { title: string; description?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-2">
      <div className="min-w-0">
        <h2 className="text-sm font-medium">{title}</h2>
        {description && <p className="text-xs text-muted-foreground">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}
