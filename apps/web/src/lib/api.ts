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

async function request<T>(method: "GET" | "POST", path: string, body?: unknown, headers: Record<string, string> = {}): Promise<T> {
  const response = await fetch(path, {
    method,
    headers: body === undefined ? headers : { "content-type": "application/json", ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
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
