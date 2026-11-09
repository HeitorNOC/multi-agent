import React from "react";

interface HostPerformance {
  hostCpuPercent: number | null;
  sampledAt: string | null;
  hostMemoryUsedBytes: number;
  hostMemoryTotalBytes: number;
  apiResidentBytes: number;
}

interface TraceEvent {
  kind: string;
  occurred_at: string;
  model_slot: string | null;
  worker_run_id: string | null;
}

interface JobEvent {
  node: string;
  detail: { wait_ms?: number };
}

interface PerformancePanelProps {
  host?: HostPerformance;
  queue?: {
    pending: number;
    capacity: number;
    running: number;
    max_workers: number;
  };
  events: JobEvent[];
  trace: TraceEvent[];
  usage?: { input_tokens: number; output_tokens: number };
}

const decimal = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 1 });
const toMiB = (bytes: number) => decimal.format(bytes / 1024 ** 2);
const seconds = (ms: number) => `${decimal.format(ms / 1000)} s`;

function inferenceDurations(events: TraceEvent[]) {
  const started = new Map<string, number>();
  const durations: number[] = [];
  for (const event of events) {
    if (!event.worker_run_id || !event.model_slot) continue;
    const key = JSON.stringify([event.worker_run_id, event.model_slot]);
    const time = Date.parse(event.occurred_at);
    if (!Number.isFinite(time)) continue;

    if (event.kind === "inference_requested") {
      started.set(key, time);
    } else if (event.kind === "inference_completed") {
      const start = started.get(key);
      if (start !== undefined && time >= start) durations.push(time - start);
      started.delete(key);
    }
  }
  return durations.sort((a, b) => a - b);
}

export function PerformancePanel({
  host,
  queue,
  events,
  trace,
  usage,
}: PerformancePanelProps) {
  const durations = inferenceDurations(trace);
  const p95 = durations[Math.ceil(0.95 * durations.length) - 1];
  const wait = events.findLast((event) => event.node === "job_dequeued")?.detail
    .wait_ms;

  return (
    <section
      className="panel performance-panel"
      aria-label="Monitoramento de desempenho"
    >
      <div className="eyebrow">TELEMETRIA LOCAL</div>
      <h2>Monitoramento de desempenho</h2>
      <div className="performance-metrics">
        <div>
          <span>Fila · instalação</span>
          <strong>
            {queue ? `${queue.pending} / ${queue.capacity}` : "—"}
          </strong>
        </div>
        <div>
          <span>Workers ativos · instalação</span>
          <strong>
            {queue ? `${queue.running} / ${queue.max_workers}` : "—"}
          </strong>
        </div>
        <div>
          <span>Última espera · trabalho</span>
          <strong>{typeof wait === "number" ? seconds(wait) : "—"}</strong>
        </div>
        <div>
          <span>Inferência p95 · trabalho</span>
          <strong>{p95 === undefined ? "—" : seconds(p95)}</strong>
          <small>
            {durations.length} {durations.length === 1 ? "chamada" : "chamadas"}{" "}
            com início e fim
          </small>
        </div>
        <div>
          <span>CPU · máquina</span>
          <strong>
            {host?.hostCpuPercent == null
              ? "—"
              : `${decimal.format(host.hostCpuPercent)}%`}
          </strong>
          <small>
            {host?.sampledAt ? "Amostras a cada 2 s" : "Aguardando amostra"}
          </small>
        </div>
        <div>
          <span>Memória · máquina</span>
          <strong>
            {host ? `${toMiB(host.hostMemoryUsedBytes)} MiB` : "—"}
          </strong>
          <small>
            {host
              ? `de ${toMiB(host.hostMemoryTotalBytes)} MiB`
              : "Capacidade indisponível"}
          </small>
        </div>
        <div>
          <span>Memória · processo da API</span>
          <strong>{host ? `${toMiB(host.apiResidentBytes)} MiB` : "—"}</strong>
          <small>Memória residente</small>
        </div>
        <div>
          <span>Tokens de entrada / saída · sessão</span>
          <strong>
            {usage
              ? `${decimal.format(usage.input_tokens)} / ${decimal.format(usage.output_tokens)}`
              : "—"}
          </strong>
        </div>
      </div>
    </section>
  );
}
