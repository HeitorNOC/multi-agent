/** Rotas da conversa com o Chief of Staff. */
import type { FastifyRequest } from "fastify";
import { z } from "zod";
import { ConversationId } from "../../../shared/ids.ts";
import type { HttpModule } from "../../../platform/http/app.ts";
import { createConversation, listConversations, readConversation, sendMessage, type ConversationDeps } from "../application/conversations.ts";

const createBody = z.strictObject({ title: z.string().trim().min(1).max(120).optional(), agent_id: z.string().min(1).max(100).optional() });
const messageBody = z.strictObject({
  text: z.string().refine((t) => t.trim().length > 0, "não pode ser vazio").pipe(z.string().max(2000)),
  client_message_id: z.string().regex(/^[A-Za-z0-9_-]{8,100}$/).optional(),
});

const idOf = (req: FastifyRequest) => ConversationId.parse((req.params as { id?: unknown }).id);

export function conversationsHttp(deps: ConversationDeps, options: { onJobOpened?: () => void } = {}): HttpModule {
  return (app, { actor }) => {
    app.get("/api/conversations", async (req) => listConversations(deps, actor(req)));

    app.post("/api/conversations", async (req, reply) => {
      const body = createBody.parse(req.body ?? {});
      return reply.code(201).send(await createConversation(deps, actor(req), body.title, body.agent_id));
    });

    app.get("/api/conversations/:id", async (req) => readConversation(deps, actor(req), idOf(req)));

    app.post("/api/conversations/:id/messages", async (req, reply) => {
      const body = messageBody.parse(req.body);
      const result = await sendMessage(deps, actor(req), idOf(req), { text: body.text, clientId: body.client_message_id });
      if (!result.replayed && result.reply.job) options.onJobOpened?.();
      return reply.code(result.replayed ? 200 : 201).send(result);
    });
  };
}
