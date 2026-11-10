/**
 * Cliente da API. Toda resposta de erro da API tem `{ error, code }`; aqui vira `ApiError`, que
 * as telas mostram com a mensagem já em português.
 */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
  }
}

/** Código da falha de conexão com a API (status 0). */
export const OFFLINE = "offline";

/** Vale tentar de novo: sem conexão ou falha do servidor; erros do pedido (4xx) não. */
export const isRetryable = (error: unknown) => !(error instanceof ApiError) || error.status === 0 || error.status >= 500;

async function request<T>(method: "GET" | "POST", path: string, body?: unknown, headers: Record<string, string> = {}): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, {
      method,
      headers: body === undefined ? headers : { "content-type": "application/json", ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    // A API não respondeu (parada, reiniciando ou rede fora): não é um erro do pedido.
    throw new ApiError(0, OFFLINE, "A API não respondeu. Os dados mostrados são os últimos carregados; a tela tenta de novo sozinha.");
  }
  const data = (await response.json().catch(() => ({}))) as { error?: string; code?: string };
  if (!response.ok) throw new ApiError(response.status, data.code ?? "unknown", data.error ?? `Falha (${response.status})`);
  return data as T;
}

const get = <T>(path: string) => request<T>("GET", path);
const post = <T>(path: string, body: unknown = {}, headers?: Record<string, string>) => request<T>("POST", path, body, headers);

/** Chave para repetir um envio sem duplicar (a mesma tentativa usa a mesma chave). */
export const newKey = () => crypto.randomUUID().replaceAll("-", "");

// ── Trabalhos ────────────────────────────────────────────────────────────────

export type JobStatus =
  | "queued"
  | "running"
  | "awaiting_approval"
  | "completed"
  | "failed"
  | "interrupted"
  | "recovery_required"
  | "closed_unknown"
  | "rejected";

export interface Citation {
  label: string;
  source: string;
  title: string;
  version: number;
  valid_from: string;
  url: string;
}

export interface OpenReport {
  kind: "open";
  abstained: boolean;
  summary: string;
  recommendation: string;
  findings: { agent: string; claim: string; citations: string[] }[];
  citations: Citation[];
  unknowns?: string[];
  plan_reason?: string;
}

export interface JobEvent {
  seq: number;
  kind: string;
  at: string;
  detail: Record<string, unknown>;
}

export interface Job {
  id: string;
  goal: string;
  status: JobStatus;
  plan: { agents?: string[]; reason?: string; max_model_calls?: number } | null;
  review: { hash: string; report: OpenReport; payload: { operation: string; recipient: string; content: string } } | null;
  approved: boolean;
  receipt: { id: string; hash: string; created?: string } | null;
  error: string | null;
  created_at: string;
  worker_active: boolean;
  events: JobEvent[];
}

export interface QueueState {
  capacity: number;
  resume_reserve: number;
  max_workers: number;
  pending: number;
  new_pending: number;
  running: number;
}

export const jobsApi = {
  list: () => get<{ jobs: Job[]; queue: QueueState }>("/api/jobs"),
  get: (id: string) => get<Job>(`/api/jobs/${id}`),
  create: (goal: string, key: string) => post<Job>("/api/jobs", { goal }, { "idempotency-key": key }),
  approve: (id: string, hash: string) => post<Job>(`/api/jobs/${id}/approve`, { hash }),
  reject: (id: string, hash: string) => post<Job>(`/api/jobs/${id}/reject`, { hash }),
  resume: (id: string) => post<Job>(`/api/jobs/${id}/resume`),
};

// ── Conversa ─────────────────────────────────────────────────────────────────

export interface ConversationSummary {
  id: string;
  title: string;
  created_at: string;
  updated_at: string;
  message_count: number;
}

export interface Message {
  seq: number;
  role: "user" | "chief";
  text: string;
  created_at: string;
  reply_to: number | null;
  job: { id: string; status: JobStatus; agents: string[] | null } | null;
  decision: { engine: string; provider?: string; fallback?: string } | null;
}

export const conversationsApi = {
  list: () => get<{ conversations: ConversationSummary[] }>("/api/conversations"),
  create: (title?: string) => post<{ id: string; title: string; created_at: string }>("/api/conversations", title ? { title } : {}),
  read: (id: string) => get<{ conversation: ConversationSummary; messages: Message[] }>(`/api/conversations/${id}`),
  send: (id: string, text: string, clientMessageId: string) =>
    post<{ replayed: boolean; user: Message; reply: Message }>(`/api/conversations/${id}/messages`, { text, client_message_id: clientMessageId }),
};

// ── Cérebro ──────────────────────────────────────────────────────────────────

export type SourceStatus = "current" | "revoked" | "not_yet_valid" | "superseded";

export interface SourceSummary {
  id: string;
  title: string;
  owner: string;
  readers: string[];
  supersedes: string | null;
  created_at: string;
  revoked_at: string | null;
  latest_version: number;
  current_version: number | null;
  superseded_by: string | null;
  status: SourceStatus;
}

export interface SourceVersion {
  version: number;
  filename: string;
  media_type: string;
  size_bytes: number;
  content_sha: string;
  valid_from: string;
  uploaded_by: string;
  created_at: string;
  url: string;
}

export interface Answer {
  abstained: boolean;
  answer: string;
  citations: { n: number; source: string; title: string; version: number; valid_from: string; excerpt: string; url: string }[];
  decision: { engine: string; provider?: string; fallback?: string };
}

export interface UploadInput {
  title: string;
  filename: string;
  media_type: string;
  content_base64: string;
  readers?: string[];
  supersedes?: string | null;
  valid_from?: string;
}

export const knowledgeApi = {
  list: () => get<{ sources: SourceSummary[]; media_types: string[] }>("/api/knowledge/sources"),
  get: (id: string) => get<SourceSummary & { versions: SourceVersion[] }>(`/api/knowledge/sources/${id}`),
  upload: (input: UploadInput) => post<SourceSummary>("/api/knowledge/sources", input),
  addVersion: (id: string, input: Omit<UploadInput, "title" | "readers" | "supersedes">) => post<SourceSummary>(`/api/knowledge/sources/${id}/versions`, input),
  revoke: (id: string) => post<SourceSummary & { repeated: boolean }>(`/api/knowledge/sources/${id}/revoke`),
  ask: (question: string) => post<Answer>("/api/knowledge/query", { question }),
};

// ── Recuperação ──────────────────────────────────────────────────────────────

export interface RecoveryCase {
  job: { id: string; goal: string; status: JobStatus; error: string | null; created_at: string; worker_active: boolean };
  pending_steps: { slot: string; reserved_at: string }[];
  evidence: JobEvent[];
}

export const recoveryApi = {
  cases: () => get<{ cases: RecoveryCase[] }>("/api/recovery/cases"),
  close: (id: string, reason: string) => post<Job>(`/api/recovery/jobs/${id}/close`, { reason }),
  retry: (id: string, reason: string, steps: string[]) => post<Job>(`/api/recovery/jobs/${id}/retry`, { reason, steps }),
};

/** Lê um arquivo como base64 (sem o prefixo `data:`). */
export function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1] ?? "");
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

// ── Agentes e empresa ────────────────────────────────────────────────────────

export interface AgentTemplate {
  id: string;
  name: string;
  title: string;
  area: string;
  tagline: string;
  focus: string;
  skills: string[];
  in_team: boolean;
}

export interface CatalogArea {
  id: string;
  title: string;
  templates: AgentTemplate[];
  in_team: number;
}

export interface Agent {
  id: string;
  template_id: string | null;
  name: string;
  title: string;
  area: string;
  tagline: string;
  focus: string;
  skills: string[];
  instructions: string;
  reports_to: string | null;
  hired_at: string;
}

export interface OrgNode {
  id: string;
  name: string;
  title: string;
  area: string;
  reports: OrgNode[];
}

export interface NewAgent {
  name: string;
  title: string;
  area: string;
  focus: string;
  tagline?: string;
  skills?: string[];
  instructions?: string;
}

export interface Organization {
  name: string;
  sector: string;
  objectives: string;
  policies: string;
  setup_completed_at: string | null;
}

export interface SetupStatus {
  steps: { company: boolean; knowledge: boolean; team: boolean };
  sources: number;
  team: number;
  completed_at: string | null;
}

export interface Settings {
  model: { provider: "none" | "claude" | "codex"; name: string | null; ready: boolean };
  chief_engine: "rules" | "model";
  knowledge_answerer: "extractive" | "model";
  knowledge_max_bytes: number;
  database: "sqlite" | "postgres";
  worker: { configured: boolean; checkpoints: boolean };
  queue: { capacity: number; resumeReserve: number; maxWorkers: number };
}

export const agentsApi = {
  catalog: () => get<{ areas: CatalogArea[] }>("/api/agents/catalog"),
  team: () => get<{ agents: Agent[] }>("/api/agents"),
  organogram: () => get<{ company: string | null; top: { name: string; title: string }; chief: { name: string; title: string; reports: OrgNode[] }; areas: { id: string; title: string }[] }>("/api/agents/organogram"),
  hire: (templateId: string) => post<Agent>("/api/agents/hire", { template_id: templateId }),
  create: (input: NewAgent) => post<Agent>("/api/agents", input),
  change: (id: string, changes: Partial<Omit<NewAgent, "area">> & { reports_to?: string | null }) => post<Agent>(`/api/agents/${id}`, changes),
  remove: (id: string) => post<{ replayed: boolean }>(`/api/agents/${id}/remove`),
};

export const companyApi = {
  get: () => get<Organization>("/api/organization"),
  save: (input: { name: string; sector?: string; objectives?: string; policies?: string }) => post<Organization>("/api/organization", input),
  setup: () => get<SetupStatus>("/api/setup"),
  completeSetup: () => post<SetupStatus>("/api/setup/complete"),
  settings: () => get<Settings>("/api/settings"),
};

// ── Entregas ─────────────────────────────────────────────────────────────────

export type DeliverableStatus = "in_review" | "accepted" | "changes_requested";

export interface DeliverableSummary {
  id: string;
  title: string;
  status: DeliverableStatus;
  current_version: number;
  created_at: string;
  updated_at: string;
  decided_by: string | null;
  decision_note: string | null;
}

export interface DeliverableDetail extends DeliverableSummary {
  versions: { version: number; job_id: string; created_at: string; content: { goal: string; report: OpenReport; payload: { recipient: string; content: string } } }[];
  reopenings: { job_id: string; from_version: number; feedback: string; requested_by: string; created_at: string }[];
  history: JobEvent[];
}

export const deliverablesApi = {
  list: () => get<{ deliverables: DeliverableSummary[] }>("/api/deliverables"),
  get: (id: string) => get<DeliverableDetail>(`/api/deliverables/${id}`),
  byJob: (jobId: string) => get<{ id: string; version: number | null; revision_of: number | null }>(`/api/deliverables/by-job/${jobId}`),
  accept: (id: string, version: number) => post<DeliverableDetail>(`/api/deliverables/${id}/accept`, { version }),
  requestChanges: (id: string, version: number, feedback: string) =>
    post<DeliverableDetail & { reopened_job: string }>(`/api/deliverables/${id}/request-changes`, { version, feedback }),
  markdownUrl: (id: string, version: number) => `/api/deliverables/${id}/versions/${version}/markdown`,
};

// ── Rotinas ──────────────────────────────────────────────────────────────────

export type Schedule = { kind: "daily"; time: string; weekdays?: number[] } | { kind: "interval"; minutes: number };

export interface RoutineRun {
  slot: string;
  trigger: "schedule" | "manual";
  status: "admitted" | "retrying" | "gave_up";
  job_id: string | null;
  job_status: JobStatus | null;
  attempts: number;
  next_attempt_at: string | null;
  last_error: string | null;
  missed: number;
  created_at: string;
}

export interface Routine {
  id: string;
  name: string;
  goal: string;
  schedule: Schedule;
  schedule_label: string;
  enabled: boolean;
  next_run_at: string | null;
  upcoming: string[];
  created_at: string;
  updated_at: string;
}

export interface RoutineInput {
  name: string;
  goal: string;
  schedule: Schedule;
  enabled?: boolean;
}

export const routinesApi = {
  list: () => get<{ time_zone: string; routines: (Routine & { last_run: RoutineRun | null })[] }>("/api/routines"),
  get: (id: string) => get<Routine & { time_zone: string; runs: RoutineRun[] }>(`/api/routines/${id}`),
  create: (input: RoutineInput) => post<Routine>("/api/routines", input),
  change: (id: string, input: Partial<RoutineInput>) => post<Routine>(`/api/routines/${id}`, input),
  archive: (id: string) => post<{ archived: boolean }>(`/api/routines/${id}/archive`),
  runNow: (id: string) => post<RoutineRun>(`/api/routines/${id}/run-now`),
};

// ── Integrações ──────────────────────────────────────────────────────────────

export interface ConnectorDef {
  id: string;
  name: string;
  category: string;
  description: string;
  capabilities: { read?: string; write?: string };
  available: boolean;
  connections: number;
}

export interface Connection {
  id: string;
  connector_id: string;
  connector: string;
  name: string;
  config: { path?: string };
  permissions: { read: boolean; write: boolean };
  status: "active" | "disconnected";
  created_at: string;
  updated_at: string;
}

export interface FolderFile {
  name: string;
  size_bytes: number;
  modified_at: string;
  media_type: string;
}

export const integrationsApi = {
  catalog: () => get<{ categories: { id: string; title: string; connectors: ConnectorDef[] }[] }>("/api/integrations/catalog"),
  list: () => get<{ connections: Connection[] }>("/api/integrations"),
  get: (id: string) => get<Connection & { history: JobEvent[] }>(`/api/integrations/${id}`),
  connect: (input: { connector_id: string; name: string; config: { path: string }; permissions: { read?: boolean; write?: boolean } }) => post<Connection>("/api/integrations", input),
  change: (id: string, input: { name?: string; permissions?: { read?: boolean; write?: boolean }; active?: boolean }) => post<Connection>(`/api/integrations/${id}`, input),
  files: (id: string) => get<{ files: FolderFile[] }>(`/api/integrations/${id}/files`),
  importFile: (id: string, file: string) => post<{ source: { id: string; title: string } }>(`/api/integrations/${id}/import`, { file }),
  exportDeliverable: (id: string, deliverableId: string, version: number) => post<{ file: string }>(`/api/integrations/${id}/export`, { deliverable_id: deliverableId, version }),
};
