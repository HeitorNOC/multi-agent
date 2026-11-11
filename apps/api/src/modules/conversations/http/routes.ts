/** Rotas da conversa com o Chief of Staff. */
import type { FastifyRequest } from "fastify";
import { z } from "zod";
import { ConversationId } from "../../../shared/ids.ts";
import type { HttpModule } from "../../../platform/http/app.ts";
import { approvePlan, cancelPlan, createConversation, decideStaffing, listConversations, MAX_ATTACHMENTS, readConversation, sendMessage, type ConversationDeps } from "../application/conversations.ts";

const createBody = z.strictObject({ title: z.string().trim().min(1).max(120).optional(), agent_id: z.string().min(1).max(100).optional() });
const messageBody = z.strictObject({
  text: z.string().refine((t) => t.trim().length > 0, "não pode ser vazio").pipe(z.string().max(2000)),
  client_message_id: z.string().regex(/^[A-Za-z0-9_-]{8,100}$/).optional(),
  attachments: z
    .array(z.strictObject({ filename: z.string().min(1).max(200), media_type: z.string().min(1).max(150), content_base64: z.string().min(1) }))
    .max(MAX_ATTACHMENTS)
    .optional(),
});

const idOf = (req: FastifyRequest) => ConversationId.parse((req.params as { id?: unknown }).id);

export function conversationsHttp(deps: ConversationDeps, options: { onJobOpened?: () => void; messageLimit?: number } = {}): HttpModule {
  return (app, { actor }) => {
    app.get("/api/conversations", async (req) => listConversations(deps, actor(req)));

    app.post("/api/conversations", async (req, reply) => {
      const body = createBody.parse(req.body ?? {});
      return reply.code(201).send(await createConversation(deps, actor(req), body.title, body.agent_id));
    });

    app.get("/api/conversations/:id", async (req) => readConversation(deps, actor(req), idOf(req)));

    // Só esta rota aceita corpo grande (anexos em base64); as demais seguem o limite padrão.
    const limit = options.messageLimit ? { bodyLimit: options.messageLimit } : {};
    app.post("/api/conversations/:id/messages", limit, async (req, reply) => {
      const body = messageBody.parse(req.body);
      const attachments = body.attachments?.map((a) => ({ filename: a.filename, mediaType: a.media_type, contentBase64: a.content_base64 }));
      const result = await sendMessage(deps, actor(req), idOf(req), { text: body.text, clientId: body.client_message_id, attachments });
      if (!result.replayed && result.reply.job) options.onJobOpened?.();
      return reply.code(result.replayed ? 200 : 201).send(result);
    });

    // Plano em elaboração (N2): o CEO aprova a versão que está vendo, ou cancela.
    const planOf = (req: { params: unknown }) => z.string().uuid().parse((req.params as { plan?: unknown }).plan);
    app.post("/api/conversations/:id/plans/:plan/approve", async (req) => {
      const { version } = z.strictObject({ version: z.number().int().min(1) }).parse(req.body);
      const result = await approvePlan(deps, actor(req), idOf(req), planOf(req), version);
      options.onJobOpened?.();
      return result;
    });
    app.post("/api/conversations/:id/plans/:plan/cancel", async (req) => cancelPlan(deps, actor(req), idOf(req), planOf(req)));

    // Proposta de contratação do Chief: aceitar contrata e abre o trabalho; recusar abre com o time atual.
    for (const [action, accept] of [["accept", true], ["decline", false]] as const)
      app.post(`/api/conversations/:id/staffing/:proposal/${action}`, async (req) => {
        const proposal = z.string().uuid().parse((req.params as { proposal?: unknown }).proposal);
        const result = await decideStaffing(deps, actor(req), idOf(req), proposal, accept);
        options.onJobOpened?.();
        return result;
      });
  };
}
