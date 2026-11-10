/**
 * Texto das fontes: extração, divisão em trechos e termos para busca.
 *
 * Formatos aceitos nesta versão: texto, Markdown, CSV e JSON (todos UTF-8). PDF e DOCX ficam
 * para quando houver um extrator confiável; recusar é melhor do que indexar texto errado.
 */
export class KnowledgeError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "KnowledgeError";
    this.status = status;
  }
}

export const SUPPORTED_MEDIA_TYPES = ["text/plain", "text/markdown", "text/csv", "application/json"] as const;
export type SupportedMediaType = (typeof SUPPORTED_MEDIA_TYPES)[number];

/** Converte o arquivo em texto pesquisável. Lança `KnowledgeError` para formato ou codificação inválidos. */
export function extractText(bytes: Uint8Array, mediaType: string): string {
  if (!(SUPPORTED_MEDIA_TYPES as readonly string[]).includes(mediaType))
    throw new KnowledgeError(415, `Formato não suportado: ${mediaType}. Aceitos: ${SUPPORTED_MEDIA_TYPES.join(", ")}`);
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new KnowledgeError(400, "O arquivo não está em UTF-8");
  }
  text = text.replace(/^﻿/, "").replace(/\r\n?/g, "\n");
  if (mediaType === "application/json") {
    try {
      text = JSON.stringify(JSON.parse(text), null, 2);
    } catch {
      throw new KnowledgeError(400, "JSON inválido");
    }
  }
  if (!text.trim()) throw new KnowledgeError(400, "O arquivo não tem texto");
  return text;
}

export interface Chunk {
  ordinal: number;
  text: string;
}

/**
 * Divide em trechos de até `max` caracteres, respeitando parágrafos; um parágrafo longo é
 * quebrado por frases. Cada trecho é a unidade citada nas respostas.
 */
export function chunk(text: string, max = 800): Chunk[] {
  const paragraphs = text.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  const pieces: string[] = [];
  for (const paragraph of paragraphs) {
    if (paragraph.length <= max) {
      pieces.push(paragraph);
      continue;
    }
    let current = "";
    for (const sentence of paragraph.split(/(?<=[.!?;])\s+/)) {
      if (current && current.length + sentence.length + 1 > max) {
        pieces.push(current);
        current = "";
      }
      // Uma "frase" maior que o limite é cortada em blocos fixos.
      for (let start = 0; start < sentence.length; start += max) {
        const part = sentence.slice(start, start + max);
        if (current && current.length + part.length + 1 > max) {
          pieces.push(current);
          current = "";
        }
        current = current ? `${current} ${part}` : part;
      }
    }
    if (current) pieces.push(current);
  }
  // Junta parágrafos curtos vizinhos para não gerar trechos pequenos demais.
  const merged: string[] = [];
  for (const piece of pieces) {
    const last = merged.at(-1);
    if (last !== undefined && last.length + piece.length + 2 <= max) merged[merged.length - 1] = `${last}\n\n${piece}`;
    else merged.push(piece);
  }
  return merged.map((text, ordinal) => ({ ordinal, text }));
}

const STOPWORDS = new Set(
  (
    "a o as os um uma uns umas de do da dos das em no na nos nas por pelo pela pelos pelas para pra " +
    "com sem sob sobre entre ate apos e ou mas nem que se como quando onde qual quais quem cujo " +
    "eu tu ele ela nos vos eles elas me te lhe isso isto aquilo esse essa este esta aquele aquela " +
    "meu minha seu sua nosso nossa ja nao sim muito mais menos tambem so ser estar ter haver " +
    "foi era sao sera seria tem tinha ha esta estao pode podem deve devem the of and to in is"
  ).split(" "),
);

/** Minúsculas e sem acentos. */
export const normalize = (text: string) => text.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/** Termos de busca: palavras normalizadas, sem palavras vazias, com um radical simples para plural. */
export function terms(text: string): string[] {
  return normalize(text)
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length >= 2 && !STOPWORDS.has(t))
    .map((t) => (t.length > 4 && t.endsWith("s") ? t.slice(0, -1) : t));
}
