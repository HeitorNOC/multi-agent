/** Repositórios SQL da empresa e do time (mesmo SQL para SQLite e PostgreSQL). */
import type { Clock } from "../../../shared/clock.ts";
import type { AgentId } from "../../../shared/ids.ts";
import type { Sql } from "../../../platform/database/database.ts";
import { SqlEventLog, type EventLog } from "../../../platform/events/event-log.ts";
import type { Agent, AgentStatus, HiredBy } from "../domain/agent.ts";
import { DEFAULT_AUTONOMY, type ChiefAutonomy, type Engagement } from "../domain/autonomy.ts";
import { EMPTY_ORGANIZATION, type Organization } from "../domain/organization.ts";

export interface AgentRepository {
  get(id: AgentId): Promise<Agent | undefined>;
  add(agent: Agent): Promise<void>;
  save(agent: Agent): Promise<void>;
  /** Na ordem de contratação. */
  list(status?: AgentStatus): Promise<Agent[]>;
}

/** Alçadas do Chief (uma linha; sem linha, valem as padrão). */
export interface AutonomyRepository {
  get(): Promise<ChiefAutonomy>;
  save(autonomy: ChiefAutonomy, actor: string, at: string): Promise<void>;
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
  engagement: string;
  engaged_job: string | null;
  hired_by: string;
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
  engagement: r.engagement as Engagement,
  engagedJob: r.engaged_job,
  hiredBy: r.hired_by as HiredBy,
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
      `INSERT INTO agents (id, template_id, name, title, area, tagline, focus, skills, instructions, reports_to, status, engagement, engaged_job, hired_by, hired_at, updated_at, ordinal)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, (SELECT COALESCE(MAX(ordinal), 0) + 1 FROM agents))`,
      [a.id, a.templateId, a.name, a.title, a.area, a.tagline, a.focus, JSON.stringify(a.skills), a.instructions, a.reportsTo, a.status, a.engagement, a.engagedJob, a.hiredBy, a.hiredAt, a.updatedAt],
    );
  }

  async save(a: Agent) {
    await this.sql.run(
      `UPDATE agents SET name = $2, title = $3, tagline = $4, focus = $5, skills = $6, instructions = $7, reports_to = $8, status = $9, updated_at = $10,
              engagement = $11, engaged_job = $12, hired_by = $13
        WHERE id = $1`,
      [a.id, a.name, a.title, a.tagline, a.focus, JSON.stringify(a.skills), a.instructions, a.reportsTo, a.status, a.updatedAt, a.engagement, a.engagedJob, a.hiredBy],
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

export class SqlAutonomyRepository implements AutonomyRepository {
  private readonly sql: Sql;
  constructor(sql: Sql) {
    this.sql = sql;
  }

  async get(): Promise<ChiefAutonomy> {
    const r = await this.sql.one<{ settings: string }>("SELECT settings FROM chief_autonomy WHERE id = 'default'");
    return r ? { ...DEFAULT_AUTONOMY, ...(JSON.parse(r.settings) as Partial<ChiefAutonomy>) } : DEFAULT_AUTONOMY;
  }

  async save(a: ChiefAutonomy, actor: string, at: string) {
    await this.sql.run(
      `INSERT INTO chief_autonomy (id, settings, updated_by, updated_at) VALUES ('default', $1, $2, $3)
       ON CONFLICT (id) DO UPDATE SET settings = $1, updated_by = $2, updated_at = $3`,
      [JSON.stringify(a), actor, at],
    );
  }
}

export interface CompanyFact {
  id: string;
  text: string;
  category: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

/** Fatos da empresa (N5): o que todo agente deve saber, editado pelo CEO. */
export class SqlCompanyFacts {
  private readonly sql: Sql;
  constructor(sql: Sql) {
    this.sql = sql;
  }

  async list(): Promise<CompanyFact[]> {
    return (
      await this.sql.all<{ id: string; text: string; category: string; created_by: string; created_at: string; updated_at: string }>("SELECT * FROM company_facts ORDER BY ordinal")
    ).map((r) => ({ id: r.id, text: r.text, category: r.category, createdBy: r.created_by, createdAt: r.created_at, updatedAt: r.updated_at }));
  }

  async add(f: CompanyFact) {
    await this.sql.run(
      `INSERT INTO company_facts (id, text, category, created_by, created_at, updated_at, ordinal)
       VALUES ($1, $2, $3, $4, $5, $6, (SELECT COALESCE(MAX(ordinal), 0) + 1 FROM company_facts))`,
      [f.id, f.text, f.category, f.createdBy, f.createdAt, f.updatedAt],
    );
  }

  async update(id: string, text: string, category: string, at: string) {
    return (await this.sql.run("UPDATE company_facts SET text = $2, category = $3, updated_at = $4 WHERE id = $1", [id, text, category, at])) > 0;
  }

  async remove(id: string) {
    return (await this.sql.run("DELETE FROM company_facts WHERE id = $1", [id])) > 0;
  }
}

export interface CompanyResource {
  id: string;
  kind: "database" | "queue" | "environment" | "repository" | "cloud" | "other";
  name: string;
  description: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

/** Recursos da empresa (N6): descrições para o Chief planejar, sem credenciais. */
export class SqlCompanyResources {
  private readonly sql: Sql;
  constructor(sql: Sql) {
    this.sql = sql;
  }

  async list(): Promise<CompanyResource[]> {
    return (
      await this.sql.all<{ id: string; kind: string; name: string; description: string; created_by: string; created_at: string; updated_at: string }>("SELECT * FROM company_resources ORDER BY ordinal")
    ).map((r) => ({ id: r.id, kind: r.kind as CompanyResource["kind"], name: r.name, description: r.description, createdBy: r.created_by, createdAt: r.created_at, updatedAt: r.updated_at }));
  }

  async add(r: CompanyResource) {
    await this.sql.run(
      `INSERT INTO company_resources (id, kind, name, description, created_by, created_at, updated_at, ordinal)
       VALUES ($1, $2, $3, $4, $5, $6, $7, (SELECT COALESCE(MAX(ordinal), 0) + 1 FROM company_resources))`,
      [r.id, r.kind, r.name, r.description, r.createdBy, r.createdAt, r.updatedAt],
    );
  }

  async update(id: string, kind: string, name: string, description: string, at: string) {
    return (await this.sql.run("UPDATE company_resources SET kind = $2, name = $3, description = $4, updated_at = $5 WHERE id = $1", [id, kind, name, description, at])) > 0;
  }

  async remove(id: string) {
    return (await this.sql.run("DELETE FROM company_resources WHERE id = $1", [id])) > 0;
  }
}

export interface AgentsStore {
  agents: AgentRepository;
  autonomy: AutonomyRepository;
  facts: SqlCompanyFacts;
  resources: SqlCompanyResources;
  organization: OrganizationRepository;
  events: EventLog;
}

export const agentsStore =
  (clock: Clock) =>
  (sql: Sql): AgentsStore => ({
    agents: new SqlAgentRepository(sql),
    autonomy: new SqlAutonomyRepository(sql),
    facts: new SqlCompanyFacts(sql),
    resources: new SqlCompanyResources(sql),
    organization: new SqlOrganizationRepository(sql),
    events: new SqlEventLog(sql, clock),
  });
