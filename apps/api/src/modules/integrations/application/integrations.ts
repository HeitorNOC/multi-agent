/**
 * Casos de uso das integrações: catálogo, conectar, ajustar permissões, desconectar e as ações
 * do conector de pasta local (listar e importar para o Cérebro; salvar entregas aceitas).
 *
 * Toda ação passa por `guard`: sem a permissão, é recusada e a recusa fica na trilha da conexão.
 */
import { randomUUID } from "node:crypto";
import type { Clock } from "../../../shared/clock.ts";
import { AppError, conflict, ensure, notFound } from "../../../shared/errors.ts";
import type { ActorId } from "../../../shared/ids.ts";
import type { Json } from "../../../shared/json.ts";
import type { UnitOfWork } from "../../../platform/database/unit-of-work.ts";
import { stream } from "../../../platform/events/event-log.ts";
import { CATEGORIES, CONNECTORS, connectorById, type Capability } from "../domain/catalog.ts";
import { authorize, permissionsFor, requireAvailable, validateName, type Connection, type ConnectionId } from "../domain/connection.ts";
import type { FolderConfig, LocalFolder } from "../infrastructure/local-folder.ts";
import type { IntegrationsStore } from "../infrastructure/sql-connections.ts";

export interface IntegrationsDeps {
  uow: UnitOfWork<IntegrationsStore>;
  clock: Clock;
  folder: LocalFolder;
  /** Envia um arquivo ao Cérebro como fonte nova (aberta a toda a empresa). */
  importToKnowledge(actor: ActorId, file: { title: string; filename: string; mediaType: string; contentBase64: string }): Promise<{ id: string; title: string }>;
  /** A entrega em Markdown, se a versão pedida for a aceita. */
  acceptedDeliverable(id: string, version: number): Promise<{ filename: string; text: string }>;
}

const view = (c: Connection) => ({
  id: c.id,
  connector_id: c.connectorId,
  connector: connectorById(c.connectorId)?.name ?? c.connectorId,
  name: c.name,
  config: c.config,
  permissions: c.permissions,
  status: c.status,
  created_at: c.createdAt,
  updated_at: c.updatedAt,
});

export async function catalogView(deps: IntegrationsDeps) {
  const connections = await deps.uow.read.connections.list();
  return {
    categories: CATEGORIES.map((cat) => ({
      ...cat,
      connectors: CONNECTORS.filter((c) => c.category === cat.id).map((c) => ({
        ...c,
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
  return { ...view(c), history: events.map((e) => ({ seq: e.seq, kind: e.kind, at: e.occurredAt, detail: e.detail })) };
}

async function validConfig(deps: IntegrationsDeps, connectorId: string, config: Json): Promise<Json> {
  if (connectorId === "local_folder") return (await deps.folder.validate(config)) as unknown as Json;
  throw conflict("connector_unavailable", "Conector indisponível");
}

export async function connect(deps: IntegrationsDeps, actor: ActorId, input: { connectorId: string; name: string; config: Json; permissions: Partial<Record<Capability, boolean>> }) {
  requireAvailable(input.connectorId);
  const now = deps.clock.now();
  const connection: Connection = {
    id: randomUUID() as ConnectionId,
    connectorId: input.connectorId,
    name: validateName(input.name),
    config: await validConfig(deps, input.connectorId, input.config),
    permissions: permissionsFor(input.connectorId, input.permissions),
    status: "active",
    createdBy: actor,
    createdAt: now,
    updatedAt: now,
  };
  await deps.uow.run(async (s) => {
    await s.connections.add(connection);
    await s.events.append(stream.connection(connection.id), { kind: "connection_created", detail: { actor, permissions: connection.permissions } });
  });
  return view(connection);
}

export async function changeConnection(deps: IntegrationsDeps, actor: ActorId, id: ConnectionId, input: { name?: string; permissions?: Partial<Record<Capability, boolean>>; active?: boolean }) {
  const current = await load(deps.uow.read, id);
  // Reconectar confere de novo a configuração (a pasta pode ter sumido).
  const config = input.active && current.status !== "active" ? await validConfig(deps, current.connectorId, current.config) : current.config;
  return deps.uow.run(async (s) => {
    const c = await load(s, id);
    const updated: Connection = {
      ...c,
      config,
      name: input.name === undefined ? c.name : validateName(input.name),
      permissions: input.permissions === undefined ? c.permissions : permissionsFor(c.connectorId, { ...c.permissions, ...input.permissions }),
      status: input.active === undefined ? c.status : input.active ? "active" : "disconnected",
      updatedAt: deps.clock.now(),
    };
    await s.connections.save(updated);
    await s.events.append(stream.connection(id), {
      kind: updated.status !== c.status ? (updated.status === "active" ? "connection_reconnected" : "connection_disconnected") : "connection_updated",
      detail: { actor, permissions: updated.permissions },
    });
    return view(updated);
  });
}

/** Autoriza a ação; sem permissão, registra a recusa na trilha e recusa. */
async function guard(deps: IntegrationsDeps, actor: ActorId, id: ConnectionId, capability: Capability, action: string): Promise<Connection & { config: FolderConfig }> {
  const c = await load(deps.uow.read, id);
  try {
    authorize(c, capability);
  } catch (error) {
    await deps.uow.run((s) =>
      s.events.append(stream.connection(id), { kind: "action_blocked", detail: { actor, action, reason: error instanceof AppError ? error.code : "error" } }),
    );
    throw error;
  }
  return c as Connection & { config: FolderConfig };
}

export async function listFiles(deps: IntegrationsDeps, actor: ActorId, id: ConnectionId) {
  const c = await guard(deps, actor, id, "read", "list_files");
  return { files: await deps.folder.list(c.config) };
}

export async function importFile(deps: IntegrationsDeps, actor: ActorId, id: ConnectionId, input: { file: string; title?: string }) {
  const c = await guard(deps, actor, id, "read", "import_file");
  const { bytes, mediaType } = await deps.folder.read(c.config, input.file);
  const title = input.title?.trim() || input.file.replace(/\.[^.]+$/, "");
  const source = await deps.importToKnowledge(actor, { title, filename: input.file, mediaType, contentBase64: Buffer.from(bytes).toString("base64") });
  await deps.uow.run((s) => s.events.append(stream.connection(id), { kind: "file_imported", detail: { actor, file: input.file, source: source.id } }));
  return { source };
}

export async function exportDeliverable(deps: IntegrationsDeps, actor: ActorId, id: ConnectionId, input: { deliverableId: string; version: number }) {
  const c = await guard(deps, actor, id, "write", "export_deliverable");
  const { filename, text } = await deps.acceptedDeliverable(input.deliverableId, input.version);
  const written = await deps.folder.write(c.config, filename, text);
  await deps.uow.run((s) =>
    s.events.append(stream.connection(id), { kind: "deliverable_exported", detail: { actor, deliverable: input.deliverableId, version: input.version, file: written } }),
  );
  return { file: written };
}
