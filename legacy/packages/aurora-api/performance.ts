import { cpus, freemem, totalmem } from "node:os";
import { memoryUsage } from "node:process";

function cpuTimes() {
  let idle = 0;
  let total = 0;
  for (const { times } of cpus()) {
    idle += times.idle;
    total += times.user + times.nice + times.sys + times.idle + times.irq;
  }
  return { idle, total };
}

export function monitorPerformance() {
  let previous = cpuTimes();
  let hostCpuPercent: number | null = null;
  let sampledAt: string | null = null;

  setInterval(() => {
    const current = cpuTimes();
    const total = current.total - previous.total;
    const idle = current.idle - previous.idle;
    hostCpuPercent =
      total > 0 && idle >= 0 && idle <= total
        ? (100 * (total - idle)) / total
        : null;
    previous = current;
    sampledAt = new Date().toISOString();
  }, 2000).unref();

  return () => ({
    hostCpuPercent,
    sampledAt,
    hostMemoryUsedBytes: totalmem() - freemem(),
    hostMemoryTotalBytes: totalmem(),
    apiResidentBytes: memoryUsage.rss(),
  });
}
