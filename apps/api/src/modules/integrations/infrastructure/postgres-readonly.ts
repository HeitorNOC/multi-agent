/**
 * Banco de dados somente leitura (N4): tabelas liberadas de um PostgreSQL (uma réplica, por
 * exemplo) entram no Cérebro como tabelas (CSV), com o resumo calculado e a sincronização de
 * sempre. O segredo é a URL de conexão de um usuário que só lê, cifrada no cofre.
 *
 * Defesas, além do usuário somente leitura no banco:
 * - toda leitura numa transação `READ ONLY`, com tempo limite e teto de linhas;
 * - o SQL é montado pelo Aurora (nunca vem do modelo nem da tela): `SELECT * FROM "esquema"."tabela"`,
 *   com nomes validados e entre aspas;
 * - com a lista de tabelas liberadas na conexão, nada fora dela é listado nem lido.
 */
import { createHash } from "node:crypto";
import pg from "pg";
import { conflict, invalid, unavailable } from "../../../shared/errors.ts";
import type { Json } from "../../../shared/json.ts";
import type { BrowseInput, ConnectorAdapter, Credentials, ExternalItem, FetchedItem } from "../domain/adapter.ts";

const IDENT = /^[A-Za-z_][A-Za-z0-9_]{0,62}$/;
const MAX_ROWS = 5000;
const TIMEOUT_MS = 15_000;

export interface ReadonlyConfig {
  /** "esquema.tabela" liberadas; sem a lista, vale o que o usuário do banco pode ler. */
  tables: string[] | null;
  max_rows: number;
}

/** "esquema.tabela" → nomes validados (sem esquema, `public`). */
export function tableName(id: string): { schema: string; table: string } {
  const parts = id.split(".");
  const [a, b] = parts.length === 1 ? ["public", parts[0]] : parts;
  if (parts.length > 2 || !IDENT.test(a ?? "") || !IDENT.test(b ?? "")) throw invalid("invalid_table", "Nome de tabela inválido");
  return { schema: a!, table: b! };
}

export function cleanConfig(raw: unknown): ReadonlyConfig {
  const c = (raw ?? {}) as { tables?: unknown; max_rows?: unknown };
  const tables = Array.isArray(c.tables) && c.tables.length ? [...new Set(c.tables.map((t) => String(t).trim()).filter(Boolean))] : null;
  for (const t of tables ?? []) tableName(t);
  const max = Number.isInteger(c.max_rows) ? Math.min(Math.max(c.max_rows as number, 1), MAX_ROWS) : MAX_ROWS;
  return { tables, max_rows: max };
}

const cell = (v: unknown) => {
  if (v === null || v === undefined) return "";
  const s = v instanceof Date ? v.toISOString() : typeof v === "object" ? JSON.stringify(v) : String(v);
  return /[;"\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** Linhas como CSV com ";" (o formato que o Cérebro já entende e calcula). */
export function toCsv(columns: string[], rows: Record<string, unknown>[]) {
  return [columns.map(cell).join(";"), ...rows.map((r) => columns.map((c) => cell(r[c])).join(";"))].join("\n") + "\n";
}

export class PostgresReadonlyAdapter implements ConnectorAdapter {
  readonly connectorId = "postgres_readonly";

  /** Abre, lê numa transação somente leitura com tempo limite e fecha sempre. */
  private async read<T>(credentials: Credentials, work: (client: pg.Client) => Promise<T>): Promise<T> {
    const url = (await credentials.get()).token;
    if (!url || !/^postgres(ql)?:\/\//.test(url)) throw invalid("invalid_url", "Informe a URL de conexão (postgres://usuario:senha@host:5432/banco)");
    const client = new pg.Client({ connectionString: url, connectionTimeoutMillis: TIMEOUT_MS, statement_timeout: TIMEOUT_MS, application_name: "aurora-leitura" });
    try {
      await client.connect();
    } catch {
      throw unavailable("database_unreachable", "Não consegui conectar ao banco; confira a URL, a rede e o usuário");
    }
    try {
      await client.query("BEGIN READ ONLY");
      await client.query(`SET LOCAL statement_timeout = ${TIMEOUT_MS}`);
      return await work(client);
    } finally {
      await client.query("ROLLBACK").catch(() => undefined);
      await client.end().catch(() => undefined);
    }
  }

  async validate(config: Json, credentials: Credentials): Promise<Json> {
    const clean = cleanConfig(config);
    await this.read(credentials, async (client) => {
      const ro = await client.query<{ transaction_read_only: string }>("SHOW transaction_read_only");
      if (ro.rows[0]?.transaction_read_only !== "on") throw conflict("not_read_only", "A conexão não ficou em modo somente leitura");
      for (const t of clean.tables ?? []) {
        const { schema, table } = tableName(t);
        const found = await client.query("SELECT 1 FROM information_schema.tables WHERE table_schema = $1 AND table_name = $2", [schema, table]);
        if (!found.rowCount) throw invalid("table_not_found", `Tabela ${schema}.${table} não encontrada ou sem acesso`);
      }
    });
    return clean as unknown as Json;
  }

  async browse(config: Json, credentials: Credentials, input: BrowseInput): Promise<{ items: ExternalItem[]; cursor: string | null }> {
    const clean = cleanConfig(config);
    const rows = await this.read(credentials, async (client) =>
      (
        await client.query<{ table_schema: string; table_name: string; table_type: string }>(
          `SELECT table_schema, table_name, table_type FROM information_schema.tables
            WHERE table_schema NOT IN ('pg_catalog', 'information_schema') AND table_schema NOT LIKE 'pg_toast%'
            ORDER BY table_schema, table_name LIMIT 500`,
        )
      ).rows,
    );
    const allowed = clean.tables ? new Set(clean.tables.map((t) => `${tableName(t).schema}.${tableName(t).table}`)) : null;
    const q = input.query?.toLowerCase();
    return {
      items: rows
        .map((r) => `${r.table_schema}.${r.table_name}`)
        .filter((id) => (!allowed || allowed.has(id)) && (!q || id.toLowerCase().includes(q)))
        .map((id, i) => ({ id, name: id, kind: "file" as const, label: rows[i]?.table_type === "VIEW" ? "Visão" : "Tabela", modified_at: null, importable: true })),
      cursor: null,
    };
  }

  async fetch(config: Json, credentials: Credentials, itemId: string): Promise<FetchedItem> {
    const clean = cleanConfig(config);
    const { schema, table } = tableName(itemId);
    if (clean.tables && !clean.tables.some((t) => { const n = tableName(t); return n.schema === schema && n.table === table; }))
      throw conflict("table_not_allowed", "Esta tabela não está liberada nesta conexão");
    const result = await this.read(credentials, (client) => client.query(`SELECT * FROM "${schema}"."${table}" LIMIT ${clean.max_rows}`));
    const columns = result.fields.map((f) => f.name);
    const csv = toCsv(columns, result.rows as Record<string, unknown>[]);
    return {
      title: `${schema}.${table}`,
      filename: `${table}.csv`,
      mediaType: "text/csv",
      bytes: new TextEncoder().encode(csv),
      revision: createHash("sha256").update(csv).digest("hex"),
    };
  }

  /** Sem atalho barato num banco genérico: lê de novo (com o teto de linhas) e compara o conteúdo. */
  async revision(config: Json, credentials: Credentials, itemId: string): Promise<string> {
    return (await this.fetch(config, credentials, itemId)).revision;
  }
}
