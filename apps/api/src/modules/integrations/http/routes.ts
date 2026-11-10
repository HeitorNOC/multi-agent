/** Rotas das integrações: catálogo, conexões e as ações do conector. */
import { z } from "zod";
import { invalid } from "../../../shared/errors.ts";
import type { Json } from "../../../shared/json.ts";
import type { HttpModule } from "../../../platform/http/app.ts";
import {
  catalogView,
  changeConnection,
  connect,
  exportDeliverable,
  importFile,
  listConnections,
  listFiles,
  viewConnection,
  type IntegrationsDeps,
} from "../application/integrations.ts";
import type { ConnectionId } from "../domain/connection.ts";

const permissions = z.strictObject({ read: z.boolean().optional(), write: z.boolean().optional() });
const connectBody = z.strictObject({ connector_id: z.string().max(60), name: z.string().max(80), config: z.record(z.string(), z.json()), permissions });
const changeBody = z.strictObject({ name: z.string().max(80).optional(), permissions: permissions.optional(), active: z.boolean().optional() });
const importBody = z.strictObject({ file: z.string().max(200), title: z.string().max(200).optional() });
const exportBody = z.strictObject({ deliverable_id: z.string().max(60), version: z.number().int().min(1) });

const idOf = (params: unknown): ConnectionId => {
  const id = (params as { id?: unknown }).id;
  if (typeof id !== "string" || !/^[0-9a-f-]{36}$/.test(id)) throw invalid("invalid_id", "Identificador de conexão inválido");
  return id as ConnectionId;
};

export function integrationsHttp(deps: IntegrationsDeps): HttpModule {
  return (app, { actor }) => {
    app.get("/api/integrations/catalog", async () => catalogView(deps));
    app.get("/api/integrations", async () => listConnections(deps));
    app.get("/api/integrations/:id", async (req) => viewConnection(deps, idOf(req.params)));

    app.post("/api/integrations", async (req, reply) => {
      const b = connectBody.parse(req.body);
      return reply.code(201).send(await connect(deps, actor(req), { connectorId: b.connector_id, name: b.name, config: b.config as Json, permissions: b.permissions }));
    });
    app.post("/api/integrations/:id", async (req) => changeConnection(deps, actor(req), idOf(req.params), changeBody.parse(req.body)));

    app.get("/api/integrations/:id/files", async (req) => listFiles(deps, actor(req), idOf(req.params)));
    app.post("/api/integrations/:id/import", async (req, reply) => reply.code(201).send(await importFile(deps, actor(req), idOf(req.params), importBody.parse(req.body))));
    app.post("/api/integrations/:id/export", async (req, reply) => {
      const b = exportBody.parse(req.body);
      return reply.code(201).send(await exportDeliverable(deps, actor(req), idOf(req.params), { deliverableId: b.deliverable_id, version: b.version }));
    });
  };
}
