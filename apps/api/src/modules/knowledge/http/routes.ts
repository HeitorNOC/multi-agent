/** Rotas do Cérebro: fontes (arquivo ou texto escrito), versões, área, revogação, original e perguntas. */
import type { FastifyRequest } from "fastify";
import { z } from "zod";
import { SourceId } from "../../../shared/ids.ts";
import type { HttpModule } from "../../../platform/http/app.ts";
import { askKnowledge } from "../application/ask.ts";
import { addVersion, listSources, moveSource, originalFile, revokeSource, uploadSource, viewSource, type FileInput, type KnowledgeDeps } from "../application/sources.ts";

const isoDate = z.string().refine((v) => !Number.isNaN(Date.parse(v)), "deve ser uma data ISO");
/** Conteúdo de uma versão: um arquivo (base64) ou um texto escrito, nunca os dois. */
const file = {
  filename: z.string().min(1).max(200).optional(),
  media_type: z.string().min(1).max(150).optional(),
  content_base64: z.string().min(1).optional(),
  text: z.string().min(1).max(2_000_000).optional(),
  valid_from: isoDate.optional(),
};
const oneContent = (b: { text?: string; filename?: string; media_type?: string; content_base64?: string }) =>
  b.text !== undefined ? b.filename === undefined && b.content_base64 === undefined : !!(b.filename && b.media_type && b.content_base64);
const contentRule = { message: "envie um arquivo (filename, media_type, content_base64) ou um texto (text)" };
const uploadBody = z
  .strictObject({
    title: z.string().trim().min(1).max(200),
    readers: z.array(z.string().min(1).max(100)).min(1).max(200).optional(),
    supersedes: z.string().nullable().optional(),
    area: z.string().min(1).max(40).optional(),
    ...file,
  })
  .refine(oneContent, contentRule);
const versionBody = z.strictObject(file).refine(oneContent, contentRule);
const moveBody = z.strictObject({ area: z.string().min(1).max(40) });
const queryBody = z.strictObject({ question: z.string().trim().min(1).max(1000), area: z.string().min(1).max(40).optional() });

/**
 * Cabeçalhos do original de uma fonte. Nunca como HTML: texto vai como texto puro e o resto como
 * download, com sandbox, para um arquivo enviado não executar nada no navegador.
 */
export function originalHeaders(mediaType: string, filename: string) {
  // PDF e Word vão como download (nunca abertos dentro da página do Aurora). Imagens raster
  // (assinatura conferida no envio; SVG não é aceito) abrem como imagem.
  const image = ["image/png", "image/jpeg", "image/webp", "image/gif"].includes(mediaType);
  const inline = image || ["text/plain", "text/markdown", "text/csv", "application/json"].includes(mediaType);
  const contentType = image
    ? mediaType
    : mediaType === "application/json"
      ? "application/json; charset=utf-8"
      : inline
        ? "text/plain; charset=utf-8"
        : "application/octet-stream";
  const ascii = filename.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
  return {
    "content-type": contentType,
    "content-disposition": `${inline ? "inline" : "attachment"}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
    "content-security-policy": "sandbox; default-src 'none'",
  };
}

const sourceIdOf =(req: FastifyRequest) => SourceId.parse((req.params as { id?: unknown }).id);
const fileInput = (b: z.infer<typeof versionBody>): FileInput => ({
  filename: b.filename,
  mediaType: b.media_type,
  contentBase64: b.content_base64,
  text: b.text,
  validFrom: b.valid_from,
});

export function knowledgeHttp(deps: KnowledgeDeps, options: { uploadLimit: number }): HttpModule {
  return (app, { actor }) => {
    const upload = { bodyLimit: options.uploadLimit };

    app.get("/api/knowledge/sources", async (req) => listSources(deps, actor(req)));

    app.post("/api/knowledge/sources", upload, async (req, reply) => {
      const b = uploadBody.parse(req.body);
      const supersedes = b.supersedes ? SourceId.parse(b.supersedes) : null;
      const view = await uploadSource(deps, actor(req), { ...fileInput(b), title: b.title, readers: b.readers, supersedes, area: b.area });
      return reply.code(201).send(view);
    });

    app.get("/api/knowledge/sources/:id", async (req) => viewSource(deps, actor(req), sourceIdOf(req)));

    app.post("/api/knowledge/sources/:id/versions", upload, async (req, reply) => {
      const view = await addVersion(deps, actor(req), sourceIdOf(req), fileInput(versionBody.parse(req.body)));
      return reply.code(201).send(view);
    });

    app.post("/api/knowledge/sources/:id/area", async (req) => moveSource(deps, actor(req), sourceIdOf(req), moveBody.parse(req.body).area));

    app.post("/api/knowledge/sources/:id/revoke", async (req) => revokeSource(deps, actor(req), sourceIdOf(req)));

    app.get("/api/knowledge/sources/:id/versions/:version/original", async (req, reply) => {
      const version = z.coerce.number().int().min(1).parse((req.params as { version?: unknown }).version);
      const original = await originalFile(deps, actor(req), sourceIdOf(req), version);
      return reply.headers(originalHeaders(original.mediaType, original.filename)).send(Buffer.from(original.bytes));
    });

    app.post("/api/knowledge/query", async (req) => {
      const b = queryBody.parse(req.body);
      return askKnowledge(deps, actor(req), b.question, { area: b.area });
    });
  };
}
