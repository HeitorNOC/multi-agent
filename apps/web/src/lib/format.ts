import type { DeliverableStatus, JobStatus, SourceStatus } from "./api";

export const JOB_STATUS: Record<JobStatus, { label: string; tone: Tone }> = {
  queued: { label: "Na fila", tone: "neutral" },
  running: { label: "Em execução", tone: "info" },
  awaiting_approval: { label: "Aguardando aprovação", tone: "warning" },
  completed: { label: "Concluído", tone: "success" },
  failed: { label: "Com falha", tone: "danger" },
  interrupted: { label: "Interrompido", tone: "warning" },
  recovery_required: { label: "Precisa de revisão", tone: "danger" },
  closed_unknown: { label: "Encerrado sem confirmação", tone: "neutral" },
  rejected: { label: "Rejeitado", tone: "neutral" },
};

export const SOURCE_STATUS: Record<SourceStatus, { label: string; tone: Tone }> = {
  current: { label: "Vigente", tone: "success" },
  not_yet_valid: { label: "Vigência futura", tone: "info" },
  superseded: { label: "Substituída", tone: "neutral" },
  revoked: { label: "Revogada", tone: "danger" },
};

export const DELIVERABLE_STATUS: Record<DeliverableStatus, { label: string; tone: Tone }> = {
  in_review: { label: "Para revisar", tone: "warning" },
  accepted: { label: "Aceita", tone: "success" },
  changes_requested: { label: "Ajustes em andamento", tone: "info" },
};

export type Tone = "neutral" | "info" | "success" | "warning" | "danger";

const dateTime = new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" });
const date = new Intl.DateTimeFormat("pt-BR", { dateStyle: "short" });

export const formatDateTime = (iso: string) => dateTime.format(new Date(iso));
export const formatDate = (iso: string) => date.format(new Date(iso));

/** "há 3 min", "há 2 h"; datas antigas no formato curto. */
export function relativeTime(iso: string, now = Date.now()) {
  const seconds = Math.round((now - new Date(iso).getTime()) / 1000);
  if (seconds < 60) return "agora";
  if (seconds < 3600) return `há ${Math.floor(seconds / 60)} min`;
  if (seconds < 86_400) return `há ${Math.floor(seconds / 3600)} h`;
  return formatDate(iso);
}

export const shortId = (id: string) => id.slice(0, 8);

/** "procurement_analyst" → "Procurement analyst" quando não há nome melhor. */
export const agentLabel = (id: string) => (id.charAt(0).toUpperCase() + id.slice(1)).replaceAll("_", " ");

export const formatBytes = (n: number) => (n < 1024 ? `${n} B` : n < 1_048_576 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1_048_576).toFixed(1)} MB`);

/** Rótulos dos eventos da trilha mostrados ao gestor. */
export const EVENT_LABEL: Record<string, string> = {
  admission: "Pedido recebido",
  job_queued: "Entrou na fila",
  job_dequeued: "Execução iniciada",
  plan: "Plano definido",
  plan_rejected: "Plano recusado",
  knowledge_retrieved: "Trechos do Cérebro entregues",
  inference_completed: "Passo do modelo concluído",
  inference_failed: "Passo do modelo falhou",
  inference_unknown: "Chamada ao modelo sem recibo",
  review_ready: "Parecer pronto",
  review_rejected: "Parecer recusado",
  human_approved: "Aprovado",
  human_rejected: "Rejeitado",
  effect_receipt: "Entregue",
  resume_requested: "Retomada pedida",
  server_restart_reconciled: "Servidor reiniciado",
  recovery_retry_authorized: "Repetição autorizada",
  recovery_closed: "Encerrado na recuperação",
  migrated_review_rehashed: "Parecer migrado da v1",
  deliverable_created: "Entrega criada",
  deliverable_revised: "Nova versão entregue",
  deliverable_accepted: "Entrega aceita",
  deliverable_changes_requested: "Ajustes pedidos",
  routine_fired: "Rotina disparou",
  routine_refused: "Rotina recusada",
  connection_created: "Conexão criada",
  knowledge_source_created: "Fonte nova no Cérebro",
  agent_hired: "Agente contratado",
  connection_updated: "Permissões ajustadas",
  connection_disconnected: "Desconectada",
  connection_reconnected: "Reconectada",
  file_imported: "Arquivo importado para o Cérebro",
  deliverable_exported: "Entrega enviada",
  action_blocked: "Ação bloqueada",
  item_imported: "Importado para o Cérebro",
  item_unchanged: "Conferido: sem mudança",
  connection_synced: "Sincronizada",
  connection_problem: "Acesso perdido: reconectar",
  connection_recovered: "Acesso de volta",
  connection_reauthorized: "Acesso renovado",
};
