/** Rotas das rotinas: listar, criar, ajustar, pausar, arquivar e rodar agora. */
import { z } from "zod";
import { invalid } from "../../../shared/errors.ts";
import type { HttpModule } from "../../../platform/http/app.ts";
import { archiveRoutine, changeRoutine, createRoutine, listRoutines, runNow, viewRoutine, type RoutinesDeps } from "../application/routines.ts";
import type { RoutineId } from "../domain/routine.ts";

const schedule = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("daily"), time: z.string().max(5), weekdays: z.array(z.number().int()).max(7).optional() }),
  z.strictObject({ kind: z.literal("interval"), minutes: z.number().int() }),
]);
const createBody = z.strictObject({ name: z.string().max(80), goal: z.string().max(2000), schedule, enabled: z.boolean().optional() });
const changeBody = createBody.partial();

const idOf = (params: unknown): RoutineId => {
  const id = (params as { id?: unknown }).id;
  if (typeof id !== "string" || !/^[0-9a-f-]{36}$/.test(id)) throw invalid("invalid_id", "Identificador de rotina inválido");
  return id as RoutineId;
};

export function routinesHttp(deps: RoutinesDeps, options: { onJobOpened: () => void }): HttpModule {
  return (app, { actor }) => {
    app.get("/api/routines", async () => listRoutines(deps));
    app.get("/api/routines/:id", async (req) => viewRoutine(deps, idOf(req.params)));
    app.post("/api/routines", async (req, reply) => reply.code(201).send(await createRoutine(deps, actor(req), createBody.parse(req.body))));
    app.post("/api/routines/:id", async (req) => changeRoutine(deps, actor(req), idOf(req.params), changeBody.parse(req.body)));
    app.post("/api/routines/:id/archive", async (req) => archiveRoutine(deps, actor(req), idOf(req.params)));
    app.post("/api/routines/:id/run-now", async (req, reply) => {
      const run = await runNow(deps, actor(req), idOf(req.params));
      if (run.status === "admitted") options.onJobOpened();
      return reply.code(run.status === "admitted" ? 202 : 200).send(run);
    });
  };
}
