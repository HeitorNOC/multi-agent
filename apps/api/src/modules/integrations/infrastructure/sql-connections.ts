/** Repositório SQL das conexões (mesmo SQL para SQLite e PostgreSQL). */
import type { Clock } from "../../../shared/clock.ts";
import type { ActorId } from "../../../shared/ids.ts";
import type { Json } from "../../../shared/json.ts";
import type { Sql } from "../../../platform/database/database.ts";
import { SqlEventLog, type EventLog } from "../../../platform/events/event-log.ts";
import type { Connection, ConnectionId } from "../domain/connection.ts";

export interface ConnectionRepository {
  get(id: ConnectionId): Promise<Connection | undefined>;
  add(connection: Connection): Promise<void>;
  save(connection: Connection): Promise<void>;
  /** Na ordem de criação. */
  list(): Promise<Connection[]>;
}

type Row = {
  id: string;
  connector_id: string;
  name: string;
  config: string;
  can_read: number | string;
  can_write: number | string;
  status: string;
  problem: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
};

const toConnection = (r: Row): Connection => ({
  id: r.id as ConnectionId,
  connectorId: r.connector_id,
  name: r.name,
  config: JSON.parse(r.config) as Json,
  permissions: { read: Number(r.can_read) === 1, write: Number(r.can_write) === 1 },
  status: r.status as Connection["status"],
  problem: r.problem ?? null,
  createdBy: r.created_by as ActorId,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

export class SqlConnectionRepository implements ConnectionRepository {
  private readonly sql: Sql;
  constructor(sql: Sql) {
    this.sql = sql;
  }

  async get(id: ConnectionId) {
    const row = await this.sql.one<Row>("SELECT * FROM connections WHERE id = $1", [id]);
    return row && toConnection(row);
  }

  async add(c: Connection) {
    await this.sql.run(
      `INSERT INTO connections (id, connector_id, name, config, can_read, can_write, status, created_by, created_at, updated_at, ordinal)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, (SELECT COALESCE(MAX(ordinal), 0) + 1 FROM connections))`,
      [c.id, c.connectorId, c.name, JSON.stringify(c.config), c.permissions.read ? 1 : 0, c.permissions.write ? 1 : 0, c.status, c.createdBy, c.createdAt, c.updatedAt],
    );
  }

  async save(c: Connection) {
    await this.sql.run("UPDATE connections SET name = $2, config = $3, can_read = $4, can_write = $5, status = $6, updated_at = $7, problem = $8 WHERE id = $1", [
      c.id,
      c.name,
      JSON.stringify(c.config),
      c.permissions.read ? 1 : 0,
      c.permissions.write ? 1 : 0,
      c.status,
      c.updatedAt,
      c.problem,
    ]);
  }

  async list() {
    return (await this.sql.all<Row>("SELECT * FROM connections ORDER BY ordinal")).map(toConnection);
  }
}

/** Segredo cifrado de cada conexão (o texto cifrado; quem abre é o cofre). */
export class SqlSecretRepository {
  private readonly sql: Sql;
  constructor(sql: Sql) {
    this.sql = sql;
  }
  async get(id: ConnectionId) {
    return (await this.sql.one<{ sealed: string }>("SELECT sealed FROM connection_secrets WHERE connection_id = $1", [id]))?.sealed;
  }
  async put(id: ConnectionId, sealed: string, at: string) {
    await this.sql.run(
      `INSERT INTO connection_secrets (connection_id, sealed, updated_at) VALUES ($1, $2, $3)
       ON CONFLICT (connection_id) DO UPDATE SET sealed = excluded.sealed, updated_at = excluded.updated_at`,
      [id, sealed, at],
    );
  }
  async remove(id: ConnectionId) {
    await this.sql.run("DELETE FROM connection_secrets WHERE connection_id = $1", [id]);
  }
}

export interface ImportedItem {
  externalId: string;
  sourceId: string;
  title: string;
  revision: string;
  importedAt: string;
  checkedAt: string;
}

type ItemRow = { external_id: string; source_id: string; title: string; revision: string; imported_at: string; checked_at: string };
const toItem = (r: ItemRow): ImportedItem => ({ externalId: r.external_id, sourceId: r.source_id, title: r.title, revision: r.revision, importedAt: r.imported_at, checkedAt: r.checked_at });

/** O que cada item externo virou no Cérebro. */
export class SqlImportedItemRepository {
  private readonly sql: Sql;
  constructor(sql: Sql) {
    this.sql = sql;
  }
  async get(id: ConnectionId, externalId: string) {
    const row = await this.sql.one<ItemRow>("SELECT * FROM connection_items WHERE connection_id = $1 AND external_id = $2", [id, externalId]);
    return row && toItem(row);
  }
  async put(id: ConnectionId, item: ImportedItem) {
    await this.sql.run(
      `INSERT INTO connection_items (connection_id, external_id, source_id, title, revision, imported_at, checked_at) VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (connection_id, external_id) DO UPDATE SET source_id = excluded.source_id, title = excluded.title, revision = excluded.revision,
         imported_at = excluded.imported_at, checked_at = excluded.checked_at`,
      [id, item.externalId, item.sourceId, item.title, item.revision, item.importedAt, item.checkedAt],
    );
  }
  async list(id: ConnectionId) {
    return (await this.sql.all<ItemRow>("SELECT * FROM connection_items WHERE connection_id = $1 ORDER BY imported_at", [id])).map(toItem);
  }
}

export interface IntegrationsStore {
  connections: ConnectionRepository;
  secrets: SqlSecretRepository;
  items: SqlImportedItemRepository;
  events: EventLog;
}

export const integrationsStore =
  (clock: Clock) =>
  (sql: Sql): IntegrationsStore => ({
    connections: new SqlConnectionRepository(sql),
    secrets: new SqlSecretRepository(sql),
    items: new SqlImportedItemRepository(sql),
    events: new SqlEventLog(sql, clock),
  });
