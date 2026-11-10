/**
 * Regras de identidade e projeção da trilha de eventos, independentes do armazenamento.
 * Compartilhado pelos adaptadores SQLite e PostgreSQL do ledger.
 */
import { createHash } from "node:crypto";

export const canonical = (x: any): string =>
  Array.isArray(x)
    ? "[" + x.map(canonical).join(",") + "]"
    : x !== null && typeof x === "object"
      ? "{" +
        Object.keys(x)
          .sort()
          .map((k) => JSON.stringify(k) + ":" + canonical(x[k]))
          .join(",") +
        "}"
      : JSON.stringify(x);
export const sha = (x: any) => createHash("sha256").update(canonical(x)).digest("hex");
export const identifier = (x: any) =>
  typeof x === "string" && /^[\w:./-]{1,200}$/.test(x) ? x : null;
export const digest = (x: any) =>
  typeof x === "string" && /^[a-f0-9]{64}$/.test(x) ? x : null;

/** Valida o id do evento e o nome do nó; lança se forem inaceitáveis. */
export function assertEventIdentity(eventId: string, node: unknown) {
  if (
    !/^[\w:-]{8,200}$/.test(eventId) ||
    typeof node !== "string" ||
    node.length > 100
  )
    throw Error("Identidade de evento inválida");
}

/** Instante do evento: o informado pela telemetria, se válido; senão o de gravação. */
export function eventTime(detail: any, recordedAt: string): string {
  const occurred = detail?.telemetry?.occurred_at;
  return typeof occurred === "string" && !Number.isNaN(Date.parse(occurred))
    ? occurred
    : recordedAt;
}

export interface StoredEvent {
  event_id: string;
  seq: number | string;
  node: string;
  at: string;
  recorded_at: string;
  detail: string;
}

/** Projeção somente leitura da trilha de um trabalho para telemetria. */
export function projectTrace(installation: string, job: string, rows: StoredEvent[]) {
  return {
    installation_id: installation,
    job_id: job,
    trace_id: sha({ installation, job }).slice(0, 32),
    read_only: true,
    events: rows.map((row) => {
      const d = JSON.parse(row.detail),
        t = d.telemetry || {};
      return {
        event_id: row.event_id,
        sequence: Number(row.seq),
        kind: row.node,
        occurred_at: row.at,
        recorded_at: row.recorded_at,
        capability_id: identifier(d.capability),
        checkpoint_id: identifier(t.checkpoint_id),
        model_slot: identifier(t.model_slot),
        worker_run_id: identifier(t.worker_run_id),
        span_id: identifier(t.span_id),
        parent_span_id: identifier(t.parent_span_id),
        input_artifact_id: digest(t.input_artifact_id),
        output_artifact_id: digest(t.output_artifact_id),
        fact_ids: Array.isArray(t.fact_ids)
          ? t.fact_ids.map(digest).filter(Boolean)
          : [],
        evidence: Array.isArray(t.evidence)
          ? t.evidence.map((x: any) => ({
              source_id: identifier(x.source_id),
              source_version: Number.isSafeInteger(x.source_version)
                ? x.source_version
                : null,
              source_hash: digest(x.source_hash),
              projection_id: identifier(x.projection_id),
              retrieved_fragment_id: digest(x.retrieved_fragment_id),
              canonical_fragment_id: digest(x.canonical_fragment_id),
            }))
          : [],
      };
    }),
  };
}
