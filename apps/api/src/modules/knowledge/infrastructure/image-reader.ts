/**
 * Leitura de imagens para o Cérebro: o modelo com visão (Claude Code ou Codex, na conta do
 * usuário) transcreve a imagem uma única vez, no envio. A transcrição vira o texto da versão:
 * a busca, as citações, o acesso e as áreas funcionam como em qualquer documento, e a citação abre
 * a imagem original. Nenhuma imagem é lida de novo a cada pergunta (rápido e barato).
 *
 * A transcrição só registra o que está visível; o que não dá para ler fica marcado como ilegível.
 */
import { AppError, invalid, rateLimited, unavailable } from "../../../shared/errors.ts";
import type { CallLimiter } from "../../../platform/model/call-limiter.ts";
import { ModelCallError, type ModelClient, type ModelImage } from "../../../platform/model/model-client.ts";
import { cleanText } from "../domain/text.ts";

const SYSTEM = `Você transcreve imagens para a base de conhecimento de uma empresa.
Registre SOMENTE o que está visível na imagem, sem deduzir nem completar.
1. "text": todo o texto legível, na ordem de leitura. Tabelas viram tabelas Markdown; listas, listas.
   Trecho ilegível vira [ilegível]. Não traduza.
2. "description": 1 a 3 frases dizendo o que a imagem mostra (por exemplo: "foto de quadro branco com o
   cronograma do projeto"), sem opinião.
Se não houver texto, deixe "text" vazio e descreva em "description".
Responda apenas com o JSON pedido.`;

const SCHEMA = {
  type: "object",
  properties: { text: { type: "string" }, description: { type: "string" } },
  required: ["text", "description"],
  additionalProperties: false,
};

export class ImageReader {
  private readonly client: ModelClient;
  private readonly limiter: CallLimiter;
  private readonly timeoutMs: number;

  constructor(options: { client: ModelClient; limiter: CallLimiter; timeoutMs: number }) {
    this.client = options.client;
    this.limiter = options.limiter;
    this.timeoutMs = options.timeoutMs;
  }

  /** Markdown com a descrição e o texto da imagem. */
  async read(image: ModelImage, filename: string): Promise<string> {
    const result = await this.limiter.tryRun(() =>
      this.client.complete({
        system: SYSTEM,
        prompt: `Transcreva a imagem "${filename}".`,
        schema: SCHEMA,
        timeoutMs: this.timeoutMs,
        images: [image],
      }),
    );
    if (result.busy) throw rateLimited("model_busy", "O modelo está ocupado com outra tarefa. Tente enviar a imagem de novo em instantes.");
    let parsed: { text?: unknown; description?: unknown };
    try {
      parsed = JSON.parse(result.value.json);
    } catch {
      throw unavailable("image_unreadable", "O modelo não devolveu uma leitura válida da imagem. Tente de novo.");
    }
    const description = typeof parsed.description === "string" ? parsed.description.trim() : "";
    const text = typeof parsed.text === "string" ? parsed.text.trim() : "";
    if (!description && !text) throw invalid("image_without_content", "Não encontrei nada legível nesta imagem");
    return cleanText([`# ${filename}`, description && `> ${description}`, text].filter(Boolean).join("\n\n"));
  }
}

/** Erro do modelo durante o envio, com mensagem para o gestor. */
export function imageReadError(error: unknown): AppError {
  if (error instanceof AppError) return error;
  if (error instanceof ModelCallError) {
    if (error.code === "quota_exhausted") return rateLimited("quota_exhausted", "A cota do modelo acabou. A imagem não foi guardada; tente quando a cota voltar.");
    return unavailable("image_model_failed", `Não foi possível ler a imagem agora (${error.code}). Nada foi guardado; tente de novo.`);
  }
  return unavailable("image_model_failed", "Não foi possível ler a imagem agora. Nada foi guardado; tente de novo.");
}
