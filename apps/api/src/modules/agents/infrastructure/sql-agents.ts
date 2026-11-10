/** Repositórios SQL da empresa e do time (mesmo SQL para SQLite e PostgreSQL). */
import type { Clock } from "../../../shared/clock.ts";
import type { AgentId } from "../../../shared/ids.ts";
import type { Sql } from "../../../platform/database/database.ts";
import { SqlEventLog, type EventLog } from "../../../platform/events/event-log.ts";
import type { Agent, AgentStatus } from "../domain/agent.ts";
import { EMPTY_ORGANIZATION, type Organization } from "../domain/organization.ts";

export interface AgentRepository {
  get(id: AgentId): Promise<Agent | undefined>;
  add(agent: Agent): Promise<void>;
  save(agent: Agent): Promise<void>;
  /** Na ordem de contratação. */
  list(status?: AgentStatus): Promise<Agent[]>;
}

export interface OrganizationRepository {
  get(): Promise<Organization>;
  save(organization: Organization): Promise<void>;
}

type AgentRow = {
  id: string;
  template_id: string | null;
  name: string;
  title: string;
  area: string;
  tagline: string;
  focus: string;
  skills: string;
  instructions: string;
  reports_to: string | null;
  status: string;
  hired_at: string;
  updated_at: string;
};

const toAgent = (r: AgentRow): Agent => ({
  id: r.id as AgentId,
  templateId: r.template_id,
  name: r.name,
  title: r.title,
  area: r.area,
  tagline: r.tagline,
  focus: r.focus,
  skills: JSON.parse(r.skills) as string[],
  instructions: r.instructions,
  reportsTo: r.reports_to as AgentId | null,
  status: r.status as AgentStatus,
  hiredAt: r.hired_at,
  updatedAt: r.updated_at,
});

export class SqlAgentRepository implements AgentRepository {
  private readonly sql: Sql;
  constructor(sql: Sql) {
    this.sql = sql;
  }

  async get(id: AgentId) {
    const row = await this.sql.one<AgentRow>("SELECT * FROM agents WHERE id = $1", [id]);
    return row && toAgent(row);
  }

  async add(a: Agent) {
    await this.sql.run(
      `INSERT INTO agents (id, template_id, name, title, area, tagline, focus, skills, instructions, reports_to, status, hired_at, updated_at, ordinal)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, (SELECT COALESCE(MAX(ordinal), 0) + 1 FROM agents))`,
      [a.id, a.templateId, a.name, a.title, a.area, a.tagline, a.focus, JSON.stringify(a.skills), a.instructions, a.reportsTo, a.status, a.hiredAt, a.updatedAt],
    );
  }

  async save(a: Agent) {
    await this.sql.run(
      `UPDATE agents SET name = $2, title = $3, tagline = $4, focus = $5, skills = $6, instructions = $7, reports_to = $8, status = $9, updated_at = $10
        WHERE id = $1`,
      [a.id, a.name, a.title, a.tagline, a.focus, JSON.stringify(a.skills), a.instructions, a.reportsTo, a.status, a.updatedAt],
    );
  }

  async list(status?: AgentStatus) {
    const rows = status
      ? await this.sql.all<AgentRow>("SELECT * FROM agents WHERE status = $1 ORDER BY ordinal", [status])
      : await this.sql.all<AgentRow>("SELECT * FROM agents ORDER BY ordinal");
    return rows.map(toAgent);
  }
}

type OrganizationRow = { name: string; sector: string; objectives: string; policies: string; setup_completed_at: string | null; updated_at: string };

export class SqlOrganizationRepository implements OrganizationRepository {
  private readonly sql: Sql;
  constructor(sql: Sql) {
    this.sql = sql;
  }

  async get(): Promise<Organization> {
    const r = await this.sql.one<OrganizationRow>("SELECT * FROM organization WHERE id = 'default'");
    if (!r) return EMPTY_ORGANIZATION;
    return { name: r.name, sector: r.sector, objectives: r.objectives, policies: r.policies, setupCompletedAt: r.setup_completed_at, updatedAt: r.updated_at };
  }

  async save(o: Organization) {
    await this.sql.run(
      `INSERT INTO organization (id, name, sector, objectives, policies, setup_completed_at, updated_at) VALUES ('default', $1, $2, $3, $4, $5, $6)
       ON CONFLICT (id) DO UPDATE SET name = $1, sector = $2, objectives = $3, policies = $4, setup_completed_at = $5, updated_at = $6`,
      [o.name, o.sector, o.objectives, o.policies, o.setupCompletedAt, o.updatedAt],
    );
  }
}

export interface AgentsStore {
  agents: AgentRepository;
  organization: OrganizationRepository;
  events: EventLog;
}

export const agentsStore =
  (clock: Clock) =>
  (sql: Sql): AgentsStore => ({
    agents: new SqlAgentRepository(sql),
    organization: new SqlOrganizationRepository(sql),
    events: new SqlEventLog(sql, clock),
  });
