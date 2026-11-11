/**
 * Casos de uso das integrações: catálogo, conectar, ajustar permissões, desconectar, e as ações
 * de cada conector: navegar, importar para o Cérebro, sincronizar o que mudou e enviar entregas
 * aceitas.
 *
 * - Pasta local: sem credencial, lida direto do disco.
 * - Conectores externos (Google Drive, Gmail, Slack): falam pela interface `ConnectorAdapter`; o
 *   token fica cifrado no cofre e só o adaptador o vê, através de `Credentials`.
 * - Toda ação passa por `guard`: sem a permissão, é recusada e a recusa fica na trilha da conexão.
 * - Se o serviço disser que o acesso não vale mais, a conexão fica marcada (`reauth_required`) e a
 *   tela pede para reconectar.
 */
import { randomUUID } from "node:crypto";
import type { Clock } from "../../../shared/clock.ts";
import { AppError, conflict, ensure, invalid, notFound } from "../../../shared/errors.ts";
import type { ActorId } from "../../../shared/ids.ts";
import type { Json } from "../../../shared/json.ts";
import type { UnitOfWork } from "../../../platform/database/unit-of-work.ts";
import { stream } from "../../../platform/events/event-log.ts";
import type { BrowseInput, ConnectorAdapter, Credentials } from "../domain/adapter.ts";
import { CATEGORIES, CONNECTORS, connectorById, type Capability } from "../domain/catalog.ts";
import { authorize, permissionsFor, requireAvailable, validateName, type Connection, type ConnectionId } from "../domain/connection.ts";
import type { FolderConfig, LocalFolder } from "../infrastructure/local-folder.ts";
import type { SecretBox } from "../infrastructure/secret-box.ts";
import type { IntegrationsStore } from "../infrastructure/sql-connections.ts";

export interface KnowledgeFile {
  title: string;
  filename: string;
  mediaType: string;
  contentBase64: string;
}

export interface IntegrationsDeps {
  uow: UnitOfWork<IntegrationsStore>;
  clock: Clock;
  folder: LocalFolder;
  /** Envia um arquivo ao Cérebro como fonte nova (aberta a toda a empresa). */
  importToKnowledge(actor: ActorId, file: KnowledgeFile): Promise<{ id: string; title: string }>;
  /**
   * Publica uma versão nova de uma fonte que veio de um conector. `changed: false` se o conteúdo é o
   * mesmo; `missing: true` se a fonte foi revogada ou apagada (então importa como fonte nova).
   */
  versionToKnowledge?(actor: ActorId, sourceId: string, file: KnowledgeFile): Promise<{ changed: boolean; missing?: boolean }>;
  /** A entrega em Markdown, se a versão pedida for a aceita. */
  acceptedDeliverable(id: string, version: number): Promise<{ filename: string; text: string }>;
  /** Adaptadores dos conectores externos disponíveis nesta instalação. */
  adapters?: Partial<Record<string, ConnectorAdapter>>;
  /** Cofre dos tokens; sem ele, conectores com segredo ficam indisponíveis. */
  vault?: SecretBox;
}

/** Itens sincronizados por vez (o resto fica para a próxima sincronização). */
const SYNC_BATCH = 50;

const view = (c: Connection) => ({
  id: c.id,
  connector_id: c.connectorId,
  connector: connectorById(c.connectorId)?.name ?? c.connectorId,
  name: c.name,
  config: c.config,
  permissions: c.permissions,
  status: c.status,
  problem: c.problem,
  created_at: c.createdAt,
  updated_at: c.updatedAt,
});

/** O conector funciona nesta instalação? Se não, o que falta (para a tela explicar). */
export function readiness(deps: IntegrationsDeps, connectorId: string): { ready: boolean; missing: string | null } {
  const connector = connectorById(connectorId);
  if (!connector?.available) return { ready: false, missing: null };
  if (connector.auth === "none") return { ready: true, missing: null };
  if (!deps.vault) return { ready: false, missing: "cofre de segredos não configurado" };
  if (!deps.adapters?.[connectorId]) return { ready: false, missing: connector.auth === "google" ? "AURORA_GOOGLE_CLIENT_ID e AURORA_GOOGLE_CLIENT_SECRET" : "adaptador" };
  return { ready: true, missing: null };
}

export async function catalogView(deps: IntegrationsDeps) {
  const connections = await deps.uow.read.connections.list();
  return {
    categories: CATEGORIES.map((cat) => ({
      ...cat,
      connectors: CONNECTORS.filter((c) => c.category === cat.id).map((c) => ({
        ...c,
        ...readiness(deps, c.id),
        connections: connections.filter((x) => x.connectorId === c.id && x.status === "active").length,
      })),
    })),
  };
}

export async function listConnections(deps: IntegrationsDeps) {
  return { connections: (await deps.uow.read.connections.list()).map(view) };
}

async function load(s: IntegrationsStore, id: ConnectionId) {
  const c = await s.connections.get(id);
  ensure(c, () => notFound("connection_not_found", "Conexão não encontrada"));
  return c;
}

export async function viewConnection(deps: IntegrationsDeps, id: ConnectionId) {
  const c = await load(deps.uow.read, id);
  const events = await deps.uow.read.events.list(stream.connection(id));
  const items = await deps.uow.read.items.list(id);
  return {
    ...view(c),
    imported: items.map((i) => ({ external_id: i.externalId, source: i.sourceId, title: i.title, imported_at: i.importedAt, checked_at: i.checkedAt })),
    history: events.map((e) => ({ seq: e.seq, kind: e.kind, at: e.occurredAt, detail: e.detail })),
  };
}

// ── Segredos ─────────────────────────────────────────────────────────────────

/** Credenciais de uma conexão já gravada: abre e grava pelo cofre, sem expor o banco. */
function storedCredentials(deps: IntegrationsDeps, id: ConnectionId): Credentials {
  const vault = deps.vault!;
  return {
    async get() {
      const sealed = await deps.uow.read.secrets.get(id);
      ensure(sealed, () => conflict("reauth_required", "Esta conexão está sem acesso. Reconecte a conta."));
      return JSON.parse(vault.open(sealed)) as Record<string, string>;
    },
    async set(secret) {
      await deps.uow.run((s) => s.secrets.put(id, vault.seal(JSON.stringify(secret)), deps.clock.now()));
    },
  };
}

/** Credenciais ainda não gravadas (ao conectar): ficam em memória até a conexão ser criada. */
function pendingCredentials(initial: Record<string, string>): Credentials & { current(): Record<string, string> } {
  let secret = { ...initial };
  return {
    get: async () => secret,
    set: async (next) => void (secret = { ...next }),
    current: () => secret,
  };
}

const adapterOf = (deps: IntegrationsDeps, connectorId: string) => {
  const adapter = deps.adapters?.[connectorId];
  ensure(adapter && readiness(deps, connectorId).ready, () => conflict("connector_unavailable", "Este conector não está configurado nesta instalação"));
  return adapter;
};

// ── Conectar ─────────────────────────────────────────────────────────────────

export interface ConnectInput {
  connectorId: string;
  name: string;
  config: Json;
  permissions: Partial<Record<Capability, boolean>>;
  /** Segredo do conector (token do Slack, tokens do Google vindos do login). Nunca é devolvido. */
  secret?: Record<string, string>;
}

export async function connect(deps: IntegrationsDeps, actor: ActorId, input: ConnectInput) {
  const connector = requireAvailable(input.connectorId);
  const now = deps.clock.now();
  let config: Json;
  let secret: Record<string, string> | undefined;
  if (connector.auth === "none") config = (await deps.folder.validate(input.config)) as unknown as Json;
  else {
    const adapter = adapterOf(deps, input.connectorId);
    ensure(input.secret, () => invalid("secret_required", connector.auth === "token" ? "Informe o token do app" : "Entre na conta para conectar"));
    const credentials = pendingCredentials(input.secret);
    config = await adapter.validate(input.config, credentials);
    secret = credentials.current();
  }
  const connection: Connection = {
    id: randomUUID() as ConnectionId,
    connectorId: input.connectorId,
    name: validateName(input.name),
    config,
    permissions: permissionsFor(input.connectorId, input.permissions),
    status: "active",
    problem: null,
    createdBy: actor,
    createdAt: now,
    updatedAt: now,
  };
  await deps.uow.run(async (s) => {
    await s.connections.add(connection);
    if (secret) await s.secrets.put(connection.id, deps.vault!.seal(JSON.stringify(secret)), now);
    await s.events.append(stream.connection(connection.id), { kind: "connection_created", detail: { actor, permissions: connection.permissions } });
  });
  return view(connection);
}

export interface ChangeInput {
  name?: string;
  permissions?: Partial<Record<Capability, boolean>>;
  active?: boolean;
  config?: Json;
  /** Segredo novo (reconectar): substitui o anterior e limpa o problema. */
  secret?: Record<string, string>;
}

export async function changeConnection(deps: IntegrationsDeps, actor: ActorId, id: ConnectionId, input: ChangeInput) {
  const current = await load(deps.uow.read, id);
  const connector = requireAvailable(current.connectorId);
  let config = current.config;
  let secret: Record<string, string> | undefined;
  const reconfigure = input.config !== undefined || input.secret !== undefined || (input.active && current.status !== "active");
  if (reconfigure) {
    if (connector.auth === "none") config = (await deps.folder.validate(input.config ?? current.config)) as unknown as Json;
    else {
      const credentials = input.secret ? pendingCredentials(input.secret) : storedCredentials(deps, id);
      config = await adapterOf(deps, current.connectorId).validate(input.config ?? current.config, credentials);
      if (input.secret) secret = (credentials as ReturnType<typeof pendingCredentials>).current();
    }
  }
  return deps.uow.run(async (s) => {
    const c = await load(s, id);
    const updated: Connection = {
      ...c,
      config,
      name: input.name === undefined ? c.name : validateName(input.name),
      permissions: input.permissions === undefined ? c.permissions : permissionsFor(c.connectorId, { ...c.permissions, ...input.permissions }),
      status: input.active === undefined ? c.status : input.active ? "active" : "disconnected",
      problem: reconfigure ? null : c.problem,
      updatedAt: deps.clock.now(),
    };
    await s.connections.save(updated);
    if (secret) await s.secrets.put(id, deps.vault!.seal(JSON.stringify(secret)), deps.clock.now());
    // Desconectar apaga o token: reconectar pede login de novo.
    if (updated.status === "disconnected" && c.status === "active" && connector.auth !== "none") await s.secrets.remove(id);
    await s.events.append(stream.connection(id), {
      kind: updated.status !== c.status ? (updated.status === "active" ? "connection_reconnected" : "connection_disconnected") : secret ? "connection_reauthorized" : "connection_updated",
      detail: { actor, permissions: updated.permissions },
    });
    return view(updated);
  });
}

// ── Ações ────────────────────────────────────────────────────────────────────

/** Autoriza a ação; sem permissão, registra a recusa na trilha e recusa. */
async function guard(deps: IntegrationsDeps, actor: ActorId, id: ConnectionId, capability: Capability, action: string): Promise<Connection> {
  const c = await load(deps.uow.read, id);
  try {
    authorize(c, capability);
  } catch (error) {
    await deps.uow.run((s) =>
      s.events.append(stream.connection(id), { kind: "action_blocked", detail: { actor, action, reason: error instanceof AppError ? error.code : "error" } }),
    );
    throw error;
  }
  return c;
}

/** Roda uma ação do serviço externo; acesso revogado marca a conexão para reconectar. */
async function external<T>(deps: IntegrationsDeps, c: Connection, work: (adapter: ConnectorAdapter, credentials: Credentials) => Promise<T>): Promise<T> {
  const adapter = adapterOf(deps, c.connectorId);
  try {
    const result = await work(adapter, storedCredentials(deps, c.id));
    if (c.problem) await setProblem(deps, c.id, null);
    return result;
  } catch (error) {
    if (error instanceof AppError && error.code === "reauth_required") await setProblem(deps, c.id, "reauth_required");
    throw error;
  }
}

async function setProblem(deps: IntegrationsDeps, id: ConnectionId, problem: string | null) {
  await deps.uow.run(async (s) => {
    const c = await load(s, id);
    if (c.problem === problem) return;
    await s.connections.save({ ...c, problem, updatedAt: deps.clock.now() });
    await s.events.append(stream.connection(id), { kind: problem ? "connection_problem" : "connection_recovered", detail: { problem } });
  });
}

/** Pasta local: arquivos da pasta. Externos: itens do serviço (pastas, e-mails, canais), paginados. */
export async function listFiles(deps: IntegrationsDeps, actor: ActorId, id: ConnectionId, input: BrowseInput = {}) {
  const c = await guard(deps, actor, id, "read", "list_files");
  if (c.connectorId === "local_folder") return { files: await deps.folder.list(c.config as unknown as FolderConfig) };
  const result = await external(deps, c, (a, cred) => a.browse(c.config, cred, input));
  const imported = new Map((await deps.uow.read.items.list(id)).map((i) => [i.externalId, i.sourceId]));
  return { items: result.items.map((item) => ({ ...item, source: imported.get(item.id) ?? null })), cursor: result.cursor };
}

const toFile = (f: { title: string; filename: string; mediaType: string; bytes: Uint8Array }, title?: string): KnowledgeFile => ({
  title: title?.trim() || f.title,
  filename: f.filename,
  mediaType: f.mediaType,
  contentBase64: Buffer.from(f.bytes).toString("base64"),
});

/**
 * Importa para o Cérebro. Pasta local: `file` (nome do arquivo). Externos: `item` (id no serviço);
 * importar de novo o mesmo item cria uma versão nova da mesma fonte (só se o conteúdo mudou).
 */
export async function importFile(deps: IntegrationsDeps, actor: ActorId, id: ConnectionId, input: { file?: string; item?: string; title?: string }) {
  const c = await guard(deps, actor, id, "read", "import_file");
  if (c.connectorId === "local_folder") {
    ensure(input.file, () => invalid("file_required", "Informe o arquivo"));
    const { bytes, mediaType } = await deps.folder.read(c.config as unknown as FolderConfig, input.file);
    const title = input.title?.trim() || input.file.replace(/\.[^.]+$/, "");
    const source = await deps.importToKnowledge(actor, { title, filename: input.file, mediaType, contentBase64: Buffer.from(bytes).toString("base64") });
    await deps.uow.run((s) => s.events.append(stream.connection(id), { kind: "file_imported", detail: { actor, file: input.file!, source: source.id } }));
    return { source };
  }
  ensure(input.item, () => invalid("item_required", "Informe o item"));
  const fetched = await external(deps, c, (a, cred) => a.fetch(c.config, cred, input.item!));
  const result = await store(deps, actor, c, input.item, fetched, input.title);
  return { source: result.source, changed: result.changed };
}

/** Grava (ou atualiza) a fonte de um item externo e o vínculo item → fonte. */
async function store(deps: IntegrationsDeps, actor: ActorId, c: Connection, externalId: string, fetched: { title: string; filename: string; mediaType: string; bytes: Uint8Array; revision: string }, title?: string) {
  const prior = await deps.uow.read.items.get(c.id, externalId);
  const file = toFile(fetched, title ?? prior?.title);
  let source: { id: string; title: string };
  let changed = true;
  if (prior && deps.versionToKnowledge) {
    const v = await deps.versionToKnowledge(actor, prior.sourceId, file);
    if (v.missing) source = await deps.importToKnowledge(actor, file);
    else {
      source = { id: prior.sourceId, title: prior.title };
      changed = v.changed;
    }
  } else source = await deps.importToKnowledge(actor, file);
  const now = deps.clock.now();
  await deps.uow.run(async (s) => {
    await s.items.put(c.id, { externalId, sourceId: source.id, title: source.title, revision: fetched.revision, importedAt: changed ? now : (prior?.importedAt ?? now), checkedAt: now });
    await s.events.append(stream.connection(c.id), { kind: changed ? "item_imported" : "item_unchanged", detail: { actor, item: externalId, source: source.id } });
  });
  return { source, changed };
}

/**
 * Sincroniza os itens já importados: confere a revisão no serviço (barato) e só baixa o que mudou.
 * Um item que falhar não impede os outros; o resumo diz o que aconteceu com cada um.
 */
export async function syncConnection(deps: IntegrationsDeps, actor: ActorId, id: ConnectionId) {
  const c = await guard(deps, actor, id, "read", "sync");
  ensure(c.connectorId !== "local_folder", () => invalid("sync_unsupported", "A pasta local é importada arquivo por arquivo"));
  const items = (await deps.uow.read.items.list(id)).sort((a, b) => a.checkedAt.localeCompare(b.checkedAt)).slice(0, SYNC_BATCH);
  const result = { updated: [] as string[], unchanged: [] as string[], failed: [] as { item: string; reason: string }[] };
  for (const item of items) {
    try {
      const revision = await external(deps, c, (a, cred) => a.revision(c.config, cred, item.externalId));
      if (revision === item.revision) {
        await deps.uow.run((s) => s.items.put(id, { ...item, checkedAt: deps.clock.now() }));
        result.unchanged.push(item.title);
        continue;
      }
      const fetched = await external(deps, c, (a, cred) => a.fetch(c.config, cred, item.externalId));
      const stored = await store(deps, actor, c, item.externalId, fetched);
      (stored.changed ? result.updated : result.unchanged).push(item.title);
    } catch (error) {
      if (error instanceof AppError && error.code === "reauth_required") throw error;
      result.failed.push({ item: item.title, reason: error instanceof AppError ? error.message : "falha inesperada" });
    }
  }
  await deps.uow.run((s) =>
    s.events.append(stream.connection(id), { kind: "connection_synced", detail: { actor, updated: result.updated.length, unchanged: result.unchanged.length, failed: result.failed.length } }),
  );
  return result;
}

export async function exportDeliverable(deps: IntegrationsDeps, actor: ActorId, id: ConnectionId, input: { deliverableId: string; version: number }) {
  const c = await guard(deps, actor, id, "write", "export_deliverable");
  const { filename, text } = await deps.acceptedDeliverable(input.deliverableId, input.version);
  let written: string;
  if (c.connectorId === "local_folder") written = await deps.folder.write(c.config as unknown as FolderConfig, filename, text);
  else
    written = (
      await external(deps, c, async (a, cred) => {
        ensure(a.write, () => invalid("capability_unsupported", "Este conector não envia entregas"));
        return a.write(c.config, cred, { filename, text });
      })
    ).location;
  await deps.uow.run((s) =>
    s.events.append(stream.connection(id), { kind: "deliverable_exported", detail: { actor, deliverable: input.deliverableId, version: input.version, file: written } }),
  );
  return { file: written };
}
