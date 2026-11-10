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
    await this.sql.run("UPDATE connections SET name = $2, config = $3, can_read = $4, can_write = $5, status = $6, updated_at = $7 WHERE id = $1", [
      c.id,
      c.name,
      JSON.stringify(c.config),
      c.permissions.read ? 1 : 0,
      c.permissions.write ? 1 : 0,
      c.status,
      c.updatedAt,
    ]);
  }

  async list() {
    return (await this.sql.all<Row>("SELECT * FROM connections ORDER BY ordinal")).map(toConnection);
  }
}

export interface IntegrationsStore {
  connections: ConnectionRepository;
  events: EventLog;
}

export const integrationsStore =
  (clock: Clock) =>
  (sql: Sql): IntegrationsStore => ({ connections: new SqlConnectionRepository(sql), events: new SqlEventLog(sql, clock) });
