/** Rotas do Cérebro: fontes, versões, revogação, original e perguntas. */
import type { FastifyRequest } from "fastify";
import { z } from "zod";
import { SourceId } from "../../../shared/ids.ts";
import type { HttpModule } from "../../../platform/http/app.ts";
import { askKnowledge } from "../application/ask.ts";
import { addVersion, listSources, originalFile, revokeSource, uploadSource, viewSource, type KnowledgeDeps } from "../application/sources.ts";

const isoDate = z.string().refine((v) => !Number.isNaN(Date.parse(v)), "deve ser uma data ISO");
const file = {
  filename: z.string().min(1).max(200),
  media_type: z.string().min(1).max(100),
  content_base64: z.string().min(1),
  valid_from: isoDate.optional(),
};
const uploadBody = z.strictObject({
  title: z.string().trim().min(1).max(200),
  readers: z.array(z.string().min(1).max(100)).min(1).max(200).optional(),
  supersedes: z.string().nullable().optional(),
  ...file,
});
const versionBody = z.strictObject(file);
const queryBody = z.strictObject({ question: z.string().trim().min(1).max(1000) });

/**
 * Cabeçalhos do original de uma fonte. Nunca como HTML: texto vai como texto puro e o resto como
 * download, com sandbox, para um arquivo enviado não executar nada no navegador.
 */
export function originalHeaders(mediaType: string, filename: string) {
  const inline = ["text/plain", "text/markdown", "text/csv", "application/json"].includes(mediaType);
  const contentType = mediaType === "application/json" ? "application/json; charset=utf-8" : inline ? "text/plain; charset=utf-8" : "application/octet-stream";
  const ascii = filename.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
  return {
    "content-type": contentType,
    "content-disposition": `${inline ? "inline" : "attachment"}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
    "content-security-policy": "sandbox; default-src 'none'",
  };
}

const sourceIdOf =(req: FastifyRequest) => SourceId.parse((req.params as { id?: unknown }).id);
const fileInput = (b: z.infer<typeof versionBody>) => ({
  filename: b.filename,
  mediaType: b.media_type,
  contentBase64: b.content_base64,
  validFrom: b.valid_from,
});

export function knowledgeHttp(deps: KnowledgeDeps, options: { uploadLimit: number }): HttpModule {
  return (app, { actor }) => {
    const upload = { bodyLimit: options.uploadLimit };

    app.get("/api/knowledge/sources", async (req) => listSources(deps, actor(req)));

    app.post("/api/knowledge/sources", upload, async (req, reply) => {
      const b = uploadBody.parse(req.body);
      const supersedes = b.supersedes ? SourceId.parse(b.supersedes) : null;
      const view = await uploadSource(deps, actor(req), { ...fileInput(b), title: b.title, readers: b.readers, supersedes });
      return reply.code(201).send(view);
    });

    app.get("/api/knowledge/sources/:id", async (req) => viewSource(deps, actor(req), sourceIdOf(req)));

    app.post("/api/knowledge/sources/:id/versions", upload, async (req, reply) => {
      const view = await addVersion(deps, actor(req), sourceIdOf(req), fileInput(versionBody.parse(req.body)));
      return reply.code(201).send(view);
    });

    app.post("/api/knowledge/sources/:id/revoke", async (req) => revokeSource(deps, actor(req), sourceIdOf(req)));

    app.get("/api/knowledge/sources/:id/versions/:version/original", async (req, reply) => {
      const version = z.coerce.number().int().min(1).parse((req.params as { version?: unknown }).version);
      const original = await originalFile(deps, actor(req), sourceIdOf(req), version);
      return reply.headers(originalHeaders(original.mediaType, original.filename)).send(Buffer.from(original.bytes));
    });

    app.post("/api/knowledge/query", async (req) => askKnowledge(deps, actor(req), queryBody.parse(req.body).question));
  };
}
