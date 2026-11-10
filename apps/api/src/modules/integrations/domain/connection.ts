/**
 * Conexão da empresa com um conector: configuração, o que está autorizado e se está ativa.
 * Toda ação passa por `authorize`; recusar é a regra quando a permissão não foi dada.
 */
import { conflict, ensure, forbidden, invalid, notFound } from "../../../shared/errors.ts";
import type { ActorId, Id } from "../../../shared/ids.ts";
import type { Json } from "../../../shared/json.ts";
import { connectorById, type Capability } from "./catalog.ts";

export type ConnectionId = Id<"Connection">;

export interface Connection {
  readonly id: ConnectionId;
  readonly connectorId: string;
  readonly name: string;
  readonly config: Json;
  readonly permissions: Readonly<Record<Capability, boolean>>;
  readonly status: "active" | "disconnected";
  readonly createdBy: ActorId;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export function requireAvailable(connectorId: string) {
  const connector = connectorById(connectorId);
  ensure(connector, () => notFound("connector_not_found", "Conector não encontrado"));
  ensure(connector.available, () => conflict("connector_unavailable", `${connector.name} ainda não está disponível`));
  return connector;
}

export function permissionsFor(connectorId: string, wanted: Partial<Record<Capability, boolean>>): Record<Capability, boolean> {
  const connector = requireAvailable(connectorId);
  const result = { read: !!wanted.read, write: !!wanted.write };
  for (const cap of ["read", "write"] as const)
    ensure(!result[cap] || connector.capabilities[cap], () => invalid("capability_unsupported", `${connector.name} não oferece ${cap === "read" ? "leitura" : "escrita"}`));
  return result;
}

export function validateName(name: string) {
  const n = name.trim();
  ensure(n.length >= 2 && n.length <= 80, () => invalid("invalid_name", "Nome da conexão deve ter de 2 a 80 caracteres"));
  return n;
}

/** Lança `forbidden` se a conexão não está ativa ou não tem a permissão pedida. */
export function authorize(connection: Connection, capability: Capability) {
  ensure(connection.status === "active", () => forbidden("connection_disconnected", "Esta conexão está desconectada"));
  ensure(connection.permissions[capability], () =>
    forbidden("permission_denied", capability === "read" ? "Leitura não autorizada nesta conexão" : "Escrita não autorizada nesta conexão"),
  );
}
