import { createHash, createHmac } from "node:crypto";

export type DestinationIntent = {
  id: string;
  scope: string;
  epoch: number;
  payload: { operation: string; recipient: string; content: string };
};

function canonical(value: unknown): string {
  if (value && typeof value === "object") {
    const entries = Object.entries(value).sort(([a], [b]) =>
      a < b ? -1 : a > b ? 1 : 0,
    );
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

type DestinationConfig = { url: string; executor: string; controller: string };

export class PilotDestination {
  private readonly config: DestinationConfig;

  constructor(config: DestinationConfig) {
    const url = new URL(config.url);
    if (
      url.protocol !== "http:" ||
      url.hostname !== "127.0.0.1" ||
      url.origin !== config.url ||
      !/^[a-f0-9]{64}$/.test(config.executor) ||
      !/^[a-f0-9]{64}$/.test(config.controller) ||
      config.executor === config.controller
    )
      throw Error("Configuração inválida do destino descartável");
    this.config = config;
  }

  private async call(action: "send" | "lookup" | "revoke", data: object) {
    const path = `/${action}`;
    const body = canonical(data);
    const key =
      action === "revoke" ? this.config.controller : this.config.executor;
    const signature = createHmac("sha256", Buffer.from(key, "hex"))
      .update(`${path}\n${body}`)
      .digest("hex");
    const response = await fetch(this.config.url + path, {
      method: "POST",
      redirect: "error",
      signal: AbortSignal.timeout(5000),
      body,
      headers: { "Content-Type": "application/json", "X-Signature": signature },
    });
    if (!response.ok)
      throw Error("Destino recusou ou não confirmou a operação");
    return (await response.json()) as any;
  }

  async receipt(action: "send" | "lookup", intent: DestinationIntent) {
    const { receipt } = await this.call(action, { intent });
    if (action === "lookup" && receipt === null) return null;
    const digest = createHash("sha256").update(canonical(intent)).digest("hex");
    if (
      !receipt ||
      typeof receipt.id !== "string" ||
      !/^[a-f0-9]{32}$/.test(receipt.id) ||
      receipt.intent !== intent.id ||
      receipt.digest !== digest ||
      receipt.simulated !== true
    )
      throw Error("Recibo do destino não corresponde à intenção");
    return receipt.id as string;
  }

  async revoke(scope: string) {
    const result = await this.call("revoke", { scope });
    return result.revoked === true;
  }
}
