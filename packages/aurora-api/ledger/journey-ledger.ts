/**
 * Porta do ledger de jornada.
 *
 * O ledger guarda o estado durável de cada trabalho: o próprio trabalho, a trilha de
 * eventos, a fila de execução, as admissões idempotentes, os recibos de efeito e os
 * registros de revogação/intenção do destino do piloto.
 *
 * O contrato é de **domínio**: cada método descreve uma operação de negócio, nunca SQL.
 * Assim o armazenamento pode mudar (SQLite local hoje, PostgreSQL depois) sem tocar nas
 * regras do servidor. Toda implementação deve passar por `journey-ledger.contract.ts`.
 *
 * Garantias que as implementações devem dar:
 *  - `transaction` é atômica: ou todas as escritas valem, ou nenhuma.
 *  - Transações são serializadas entre si (um escritor por vez dentro da instalação).
 *  - Leituras fora de transação nunca enxergam escritas de uma transação em andamento.
 *  - Dentro de `transaction`, use apenas o `tx` recebido; usar o ledger externo é um erro.
 */

export type JobStatus =
  | "created"
  | "queued"
  | "running"
  | "awaiting_approval"
  | "completed"
  | "failed"
  | "interrupted"
  | "recovery_required"
  | "closed_unknown"
  | "rejected";

/**
 * Registro de um trabalho. Os campos JSON (`plan`, `review`, `receipt`) ficam como texto
 * exatamente como foram gravados: o servidor compara e calcula hashes sobre esse texto.
 */
export interface JobRecord {
  readonly id: string;
  readonly goal: string;
  readonly status: JobStatus;
  readonly plan: string | null;
  readonly review: string | null;
  readonly approval: string | null;
  readonly receipt: string | null;
  readonly error: string | null;
  readonly created: string;
}

export interface NewJob {
  id: string;
  goal: string;
  status: JobStatus;
  created: string;
  /** Parecer já vinculado na criação (entregas de repositório). */
  review?: string;
}

/** Campos alteráveis de um trabalho. `null` limpa o campo; ausente mantém o valor. */
export interface JobPatch {
  status?: JobStatus;
  plan?: string;
  review?: string;
  approval?: string | null;
  receipt?: string;
  error?: string | null;
}

const PATCHABLE = ["status", "plan", "review", "approval", "receipt", "error"] as const;
export type PatchableField = (typeof PATCHABLE)[number];

/**
 * Campos de `patch` que devem ser gravados, em ordem estável. A lista fixa impede que um
 * nome de campo vire SQL. Lança `LedgerUsageError` se não houver nenhum.
 */
export function patchedColumns(patch: JobPatch): PatchableField[] {
  const columns = PATCHABLE.filter((c) => patch[c] !== undefined);
  if (!columns.length) throw new LedgerUsageError("updateJob requer ao menos um campo");
  return columns;
}

export interface JobGuard {
  /** A alteração só ocorre se o status atual estiver neste conjunto. */
  statusIn: readonly JobStatus[];
}

export interface EventRecord {
  seq: number;
  at: string;
  node: string;
  /** JSON como texto, na forma gravada. */
  detail: string;
}

export interface AppendedEvent {
  ok: true;
  event_id: string;
  /** `true` quando o mesmo evento (mesmo id e conteúdo) já existia. */
  replayed: boolean;
}

export type QueueKind = "new" | "resume";

export interface QueueEntry {
  seq: number;
  job: string;
  kind: QueueKind;
  crash: boolean;
  queuedAt: string;
}

export interface QueueDepth {
  total: number;
  newRequests: number;
}

export interface ReceiptRecord {
  hash: string;
  /** JSON como texto. */
  receipt: string;
}

export type RecoveryCommandStatus = "dispatching" | "completed" | "unknown" | "rejected";

/** Sessão de um revisor da central de recuperação. `hash` é o do token; o token nunca é gravado. */
export interface RecoverySession {
  hash: string;
  actor: string;
  /** Hash da identidade do revisor no momento do login; mudar a credencial invalida a sessão. */
  authSha: string;
  /** Epoch em milissegundos. */
  expires: number;
}

export interface RecoveryCommand {
  id: string;
  actor: string;
  inputSha: string;
  /** Corpo original do envio, como JSON em texto. */
  body: string;
  action: string;
  caseId: string;
  operationId: string;
  evidenceSha: string;
  status: RecoveryCommandStatus;
  /** Resultado como JSON em texto; só existe depois de `completed`. */
  result: string | null;
  updated: string;
}

export type RecoveryCommandSummary = Omit<RecoveryCommand, "inputSha" | "body" | "result">;

export type ConversationRole = "user" | "chief";

/** Conversa de um usuário com o Chief of Staff. A instalação (empresa) é o próprio banco. */
export interface Conversation {
  id: string;
  /** Identidade do usuário dono da conversa; só ele a enxerga. */
  actor: string;
  title: string;
  created: string;
  /** Instante da última mensagem; ordena a lista. */
  updated: string;
}

export interface ConversationSummary extends Conversation {
  messageCount: number;
}

export interface NewConversationMessage {
  conversation: string;
  role: ConversationRole;
  text: string;
  /** Trabalho aberto a partir desta mensagem (resposta do Chief of Staff). */
  job?: string | null;
  /** Chave do cliente para repetir um envio sem duplicar; única por conversa. */
  clientId?: string | null;
  /** `seq` da mensagem do usuário a que esta responde. */
  replyTo?: number | null;
  created: string;
}

export interface ConversationMessage {
  seq: number;
  conversation: string;
  role: ConversationRole;
  text: string;
  job: string | null;
  clientId: string | null;
  replyTo: number | null;
  created: string;
}

/** Fonte de conhecimento do Cérebro. O conteúdo fica nas versões; a fonte guarda dono e acesso. */
export interface KnowledgeSource {
  id: string;
  title: string;
  /** Quem enviou a fonte; só ele publica versões novas ou revoga. */
  owner: string;
  /** Quem pode ler e consultar: identidades ou "*" para todos da instalação. O dono sempre lê. */
  readers: string[];
  /** Fonte que esta substitui; a substituída deixa de ser vigente enquanto esta valer. */
  supersedes: string | null;
  created: string;
  revoked: string | null;
  revokedBy: string | null;
  /** Maior versão enviada (não necessariamente a vigente, que depende de `validFrom`). */
  latestVersion: number;
}

export interface KnowledgeVersionInfo {
  source: string;
  version: number;
  mediaType: string;
  filename: string;
  contentSha: string;
  /** A partir de quando esta versão vale. */
  validFrom: string;
  uploadedBy: string;
  created: string;
  sizeBytes: number;
}

export interface KnowledgeVersion extends KnowledgeVersionInfo {
  /** Arquivo original, exatamente como enviado. */
  bytes: Uint8Array;
  /** Texto extraído, usado para busca e citação. */
  text: string;
}

/** Dados para gravar uma versão; o tamanho é calculado pelo armazenamento. */
export type NewKnowledgeVersion = Omit<KnowledgeVersion, "sizeBytes">;

/** Versões de fontes não revogadas, com o texto, para montar o índice de busca. */
export interface IndexableKnowledge {
  source: string;
  title: string;
  readers: string[];
  owner: string;
  supersedes: string | null;
  version: number;
  validFrom: string;
  text: string;
}

/**
 * Recibo de uma chamada ao modelo dentro de um trabalho. A chamada é reservada ANTES de
 * acontecer e completada DEPOIS. Uma reserva sem recibo após uma queda significa resultado
 * desconhecido: a chamada não é refeita automaticamente.
 */
export interface InferenceRecord {
  job: string;
  /** Identifica a chamada dentro do trabalho (por exemplo, `plan`, `specialist:analista`). */
  slot: string;
  /** Hash da entrada; repetir o mesmo slot com outra entrada é recusado. */
  inputSha: string;
  state: "reserved" | "completed";
  /** Saída validada, como JSON em texto. */
  output: string | null;
  /** Uso observado (tokens), como JSON em texto. */
  usage: string | null;
  created: string;
  updated: string;
}

/** Operações disponíveis tanto fora quanto dentro de uma transação. */
export interface JourneyStore {
  // Trabalhos
  getJob(id: string): Promise<JobRecord | undefined>;
  /** Ids do mais recente para o mais antigo. */
  listJobIds(): Promise<string[]>;
  listJobIdsByStatus(status: JobStatus): Promise<string[]>;
  latestJobForGoal(goal: string): Promise<{ id: string; status: JobStatus } | undefined>;
  insertJob(job: NewJob): Promise<void>;
  /** Devolve `false` se o trabalho não existe ou se `guard` não é satisfeito. */
  updateJob(id: string, patch: JobPatch, guard?: JobGuard): Promise<boolean>;

  // Eventos
  appendEvent(job: string, node: string, detail: unknown, eventId?: string): Promise<AppendedEvent>;
  listEvents(job: string): Promise<EventRecord[]>;
  /** Projeção somente leitura da trilha para telemetria. */
  trace(job: string): Promise<unknown>;

  // Fila
  enqueue(entry: { job: string; kind: QueueKind; crash: boolean; queuedAt: string }): Promise<QueueEntry>;
  peekQueue(): Promise<QueueEntry | undefined>;
  /** Remove a entrada; `false` se ela já não existe (fila alterada por outro caminho). */
  dequeue(seq: number, job: string): Promise<boolean>;
  queueDepth(): Promise<QueueDepth>;

  // Admissão idempotente
  findAdmittedJob(key: string): Promise<string | undefined>;
  recordAdmission(key: string, job: string): Promise<void>;

  // Efeitos
  getEffect(job: string): Promise<ReceiptRecord | undefined>;
  recordEffect(job: string, hash: string, receipt: string): Promise<void>;

  // Revogação de referência financeira do piloto
  /** `true` se a revogação foi registrada agora; `false` se já existia. */
  revokeReference(version: string): Promise<boolean>;
  isReferenceRevoked(version: string): Promise<boolean>;

  // Diário de destino do piloto (só existe se habilitado na criação do ledger)
  revokeDestinationScope(scope: string): Promise<boolean>;
  isDestinationRevocationAcknowledged(scope: string): Promise<boolean>;
  /** `true` se a confirmação mudou agora de pendente para reconhecida. */
  acknowledgeDestinationRevocation(scope: string): Promise<boolean>;
  getDestinationIntent(job: string): Promise<string | undefined>;
  recordDestinationIntent(job: string, intent: string): Promise<void>;
  /** Há revogação sem confirmação ou intenção sem efeito registrado. */
  hasPendingDestinationWork(): Promise<boolean>;

  // Conversa com o Chief of Staff
  createConversation(conversation: { id: string; actor: string; title: string; created: string }): Promise<void>;
  getConversation(id: string): Promise<Conversation | undefined>;
  /** Do mais recente para o mais antigo. */
  listConversationsForActor(actor: string): Promise<ConversationSummary[]>;
  /**
   * Acrescenta uma mensagem e atualiza `updated` da conversa. Lança `LedgerUsageError` se a
   * conversa não existe e falha se `clientId` já foi usado na mesma conversa.
   */
  appendConversationMessage(message: NewConversationMessage): Promise<ConversationMessage>;
  findConversationMessageByClientId(conversation: string, clientId: string): Promise<ConversationMessage | undefined>;
  /** A resposta do Chief of Staff a uma mensagem do usuário, se já existir. */
  findConversationReply(conversation: string, replyTo: number): Promise<ConversationMessage | undefined>;
  /** Em ordem de envio. `afterSeq` e `limit` permitem paginar. */
  listConversationMessages(conversation: string, page?: { afterSeq?: number; limit?: number }): Promise<ConversationMessage[]>;

  // Cérebro: fontes de conhecimento
  createKnowledgeSource(source: {
    id: string;
    title: string;
    owner: string;
    readers: string[];
    supersedes: string | null;
    created: string;
  }): Promise<void>;
  getKnowledgeSource(id: string): Promise<KnowledgeSource | undefined>;
  /** Todas as fontes, inclusive revogadas; o filtro de acesso fica no serviço. Mais recentes primeiro. */
  listKnowledgeSources(): Promise<KnowledgeSource[]>;
  /**
   * Grava uma versão nova. `version` precisa ser `latestVersion + 1` da fonte; caso contrário
   * lança `LedgerUsageError` (protege contra dois envios concorrentes da mesma versão).
   */
  addKnowledgeVersion(version: NewKnowledgeVersion): Promise<void>;
  getKnowledgeVersion(source: string, version: number): Promise<KnowledgeVersion | undefined>;
  /** Metadados das versões, da mais nova para a mais antiga, sem conteúdo. */
  listKnowledgeVersions(source: string): Promise<KnowledgeVersionInfo[]>;
  /** `true` se revogou agora; `false` se já estava revogada ou não existe. */
  revokeKnowledgeSource(id: string, actor: string, at: string): Promise<boolean>;
  listIndexableKnowledge(): Promise<IndexableKnowledge[]>;

  // Recibos de inferência
  /** Reserva a chamada; se já existir, devolve a existente com `created: false`. */
  reserveInference(entry: { job: string; slot: string; inputSha: string; created: string }): Promise<{
    created: boolean;
    record: InferenceRecord;
  }>;
  /** Grava o recibo de uma reserva pendente; `false` se não havia reserva pendente. */
  completeInference(job: string, slot: string, output: string, usage: string, at: string): Promise<boolean>;
  getInference(job: string, slot: string): Promise<InferenceRecord | undefined>;
  /** Em ordem de reserva. */
  listInferences(job: string): Promise<InferenceRecord[]>;

  // Central de recuperação humana
  createRecoverySession(session: RecoverySession): Promise<void>;
  findRecoverySession(hash: string): Promise<RecoverySession | undefined>;
  deleteRecoverySession(hash: string): Promise<void>;
  getRecoveryCommand(id: string): Promise<RecoveryCommand | undefined>;
  /** O comando só é devolvido se pertencer ao revisor informado. */
  getRecoveryCommandForActor(id: string, actor: string): Promise<RecoveryCommand | undefined>;
  insertRecoveryCommand(command: RecoveryCommand): Promise<void>;
  /** Muda o estado; `result` só é gravado se informado. */
  updateRecoveryCommandStatus(
    id: string,
    status: RecoveryCommandStatus,
    updated: string,
    result?: string,
  ): Promise<void>;
  /** Comandos que estavam sendo enviados quando o processo caiu. */
  listDispatchingRecoveryCommands(): Promise<{ id: string; caseId: string }[]>;
  /** Do mais recente para o mais antigo. */
  listRecoveryCommandsForActor(actor: string): Promise<RecoveryCommandSummary[]>;
}

export interface JourneyLedger extends JourneyStore {
  /**
   * Executa `work` de forma atômica e serializada. Se `work` lançar, nada é gravado e o
   * erro é propagado. Use somente o `tx` recebido dentro do callback.
   */
  transaction<T>(work: (tx: JourneyStore) => Promise<T>): Promise<T>;
  /**
   * Liga ou desliga a regra "no máximo um trabalho ativo (created ou running)". Deve ser
   * chamado depois da conciliação do reinício, pois ligar falha se já houver mais de um.
   */
  setSingleActiveJob(enabled: boolean): Promise<void>;
  close(): Promise<void>;
}

/** Erro de uso do ledger (por exemplo, chamar o ledger externo dentro de uma transação). */
export class LedgerUsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LedgerUsageError";
  }
}
