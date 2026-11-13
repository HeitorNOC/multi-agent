/** JSON canônico (chaves ordenadas) e hash. Usado onde o conteúdo exato importa: aprovação, recibos, eventos. */
import { createHash } from "node:crypto";

export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

export function canonical(value: unknown): string {
  if (Array.isArray(value)) return "[" + value.map(canonical).join(",") + "]";
  if (value !== null && typeof value === "object")
    return (
      "{" +
      Object.keys(value)
        .sort()
        .map((k) => JSON.stringify(k) + ":" + canonical((value as Record<string, unknown>)[k]))
        .join(",") +
      "}"
    );
  return JSON.stringify(value);
}

export const sha256 = (text: string | Uint8Array) => createHash("sha256").update(text).digest("hex");
export const hashOf = (value: unknown) => sha256(canonical(value));
