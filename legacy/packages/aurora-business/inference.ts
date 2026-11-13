/** Authenticated durable inference transport. Does not own workflow scheduling. */
import { createHash, createHmac } from "node:crypto";
import { RetainedError } from "./retained.ts";
export const textHash = (text: string) =>
  createHash("sha256").update(text).digest("hex");
export class Inference {
  c: { url: string; key: string };
  constructor(c: { url: string; key: string }) {
    this.c = c;
  }
  async call(action: string, id: string, input_json?: string): Promise<any> {
    const raw = JSON.stringify({
      action,
      id,
      ...(input_json === undefined ? {} : { input_json }),
      issued: Date.now() / 1000,
    });
    let response: Response;
    try {
      response = await fetch(this.c.url + "/rpc", {
        method: "POST",
        body: raw,
        signal: AbortSignal.timeout(330000),
        headers: {
          "content-type": "application/json",
          "x-signature": createHmac("sha256", Buffer.from(this.c.key, "hex"))
            .update(raw)
            .digest("hex"),
        },
      });
    } catch {
      throw new RetainedError(
        503,
        "inference outcome unavailable; reconcile before retry",
      );
    }
    if (!response.ok)
      throw new RetainedError(
        response.status === 409 ? 409 : 503,
        "inference refused; do not regenerate unknown output",
      );
    return response.json();
  }
  async obtain(row: any, beforeDispatch: () => void) {
    let receipt = await this.call("inference_lookup", row.id);
    if (receipt.state === "absent") {
      beforeDispatch();
      receipt = await this.call("inference_run", row.id, row.input_json);
    }
    return this.verify(row, receipt);
  }
  async closeUnknown(row: any) {
    const receipt = await this.call(
      "inference_close_unknown",
      row.id,
      row.input_json,
    );
    if (
      receipt.id !== row.id ||
      receipt.input_sha !== textHash(row.input_json) ||
      receipt.state !== "closed_unknown" ||
      receipt.outcome !== "unknown_not_reexecuted"
    )
      throw new RetainedError(503, "unknown closure receipt input mismatch");
    return receipt;
  }
  verify(row: any, receipt: any) {
    if (receipt.state !== "complete")
      throw new RetainedError(
        409,
        "inference pending or unknown; no automatic regeneration",
      );
    if (
      receipt.id !== row.id ||
      receipt.input_sha !== textHash(row.input_json) ||
      !receipt.semantic
    )
      throw new RetainedError(503, "inference receipt input mismatch");
    return receipt;
  }
}
