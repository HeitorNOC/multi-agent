/**
 * Texto das fontes: formatos aceitos, extração dos formatos de texto, divisão em trechos e
 * termos de busca.
 *
 * Formatos de texto (UTF-8) são lidos aqui. PDF e Word precisam de um extrator
 * (`infrastructure/document-text.ts`); um PDF sem texto (escaneado) é recusado: indexar nada ou
 * texto errado é pior do que pedir outro arquivo.
 */
import { AppError, invalid } from "../../../shared/errors.ts";

export interface FileFormat {
  /** Como aparece na tela. */
  readonly label: string;
  readonly extensions: readonly string[];
  /** `text`: lido direto como UTF-8. `document`: precisa de extrator. */
  readonly kind: "text" | "document";
}

export const FORMATS = {
  "text/plain": { label: "TXT", extensions: ["txt"], kind: "text" },
  "text/markdown": { label: "MD", extensions: ["md", "markdown"], kind: "text" },
  "text/csv": { label: "CSV", extensions: ["csv"], kind: "text" },
  "application/json": { label: "JSON", extensions: ["json"], kind: "text" },
  "application/pdf": { label: "PDF", extensions: ["pdf"], kind: "document" },
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": { label: "Word", extensions: ["docx"], kind: "document" },
} as const satisfies Record<string, FileFormat>;

export type SupportedMediaType = keyof typeof FORMATS;
export const SUPPORTED_MEDIA_TYPES = Object.keys(FORMATS) as SupportedMediaType[];

export const formatOf = (mediaType: string): FileFormat | undefined => (FORMATS as Record<string, FileFormat>)[mediaType];

export function ensureSupported(mediaType: string): FileFormat {
  const format = formatOf(mediaType);
  if (!format)
    throw new AppError("unsupported", "unsupported_media_type", `Formato não suportado: ${mediaType}. Aceitos: ${Object.values(FORMATS).map((f) => f.label).join(", ")}`);
  return format;
}

/** Converte um arquivo de texto em texto pesquisável. Lança `AppError` para formato ou codificação inválidos. */
export function extractText(bytes: Uint8Array, mediaType: string): string {
  if (ensureSupported(mediaType).kind !== "text")
    throw new AppError("unsupported", "unsupported_media_type", `Formato ${mediaType} precisa de extrator de documento`);
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw invalid("invalid_encoding", "O arquivo não está em UTF-8");
  }
  text = text.replace(/^﻿/, "");
  if (mediaType === "application/json") {
    try {
      text = JSON.stringify(JSON.parse(text), null, 2);
    } catch {
      throw invalid("invalid_json_file", "JSON inválido");
    }
  }
  return cleanText(text);
}

/** Normaliza quebras e espaços; recusa texto vazio. Vale para qualquer formato. */
export function cleanText(raw: string): string {
  const text = raw
    .replace(/\r\n?/g, "\n")
    // Espaços no fim da linha saem; a indentação (JSON, listas) fica.
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  if (!text) throw invalid("empty_text", "O arquivo não tem texto");
  return text;
}

export interface Chunk {
  ordinal: number;
  /** O texto citado. */
  text: string;
  /** Seção do documento em que o trecho está (título Markdown mais próximo); entra na busca. */
  section?: string;
}

const HEADING = /^#{1,6}\s+(.+)$/;

/**
 * Divide em trechos de até `max` caracteres. Cada trecho é a unidade citada nas respostas.
 * - CSV: grupos de linhas, sempre com o cabeçalho na frente (o trecho se explica sozinho).
 * - Demais: respeita parágrafos; parágrafo longo é quebrado por frases; parágrafos curtos
 *   vizinhos da mesma seção são juntados. Cada trecho guarda o título da seção em que está.
 */
export function chunk(text: string, max = 800, mediaType?: string): Chunk[] {
  if (mediaType === "text/csv") return csvChunks(text, max);
  const pieces: { text: string; section?: string }[] = [];
  let section: string | undefined;
  for (const paragraph of text.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean)) {
    const heading = paragraph.split("\n")[0]!.match(HEADING);
    if (heading) section = heading[1]!.trim();
    for (const piece of splitLong(paragraph, max)) pieces.push({ text: piece, section });
  }
  const merged: { text: string; section?: string }[] = [];
  for (const piece of pieces) {
    const last = merged.at(-1);
    // Um título abre trecho novo, a não ser que o trecho anterior seja só títulos (# Doc / ## Seção).
    const onlyHeadings = !!last && last.text.split("\n").every((l) => !l.trim() || HEADING.test(l));
    const joinable = !!last && (HEADING.test(piece.text) ? onlyHeadings : last.section === piece.section);
    if (last && joinable && last.text.length + piece.text.length + 2 <= max) {
      last.text = `${last.text}\n\n${piece.text}`;
      last.section = piece.section;
    } else merged.push({ ...piece });
  }
  return merged.map((p, ordinal) => ({ ordinal, text: p.text, ...(p.section ? { section: p.section } : {}) }));
}

function splitLong(paragraph: string, max: number): string[] {
  if (paragraph.length <= max) return [paragraph];
  const out: string[] = [];
  let current = "";
  for (const sentence of paragraph.split(/(?<=[.!?;])\s+|\n/)) {
    // Uma "frase" maior que o limite é cortada em blocos fixos.
    for (let start = 0; start < sentence.length; start += max) {
      const part = sentence.slice(start, start + max);
      if (current && current.length + part.length + 1 > max) {
        out.push(current);
        current = "";
      }
      current = current ? `${current} ${part}` : part;
    }
  }
  if (current) out.push(current);
  return out;
}

function csvChunks(text: string, max: number): Chunk[] {
  const [header, ...rows] = text.split("\n").filter((l) => l.trim());
  if (!header) return [];
  if (!rows.length) return [{ ordinal: 0, text: header }];
  const chunks: Chunk[] = [];
  let current: string[] = [];
  const flush = () => {
    if (current.length) chunks.push({ ordinal: chunks.length, text: [header, ...current].join("\n") });
    current = [];
  };
  for (const row of rows) {
    if (current.length && header.length + current.join("\n").length + row.length + 2 > max) flush();
    current.push(row);
  }
  flush();
  return chunks;
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

/**
 * Plural para singular em português (regras do passo de plural do RSLP, sem acentos):
 * fornecedores → fornecedor, contratos → contrato, papeis → papel, acoes → acao.
 */
function singular(t: string): string {
  if (t.length <= 3 || !t.endsWith("s")) return t;
  if (t.endsWith("oes") || t.endsWith("aes")) return t.slice(0, -3) + "ao";
  if (t.endsWith("ais") && t.length > 4) return t.slice(0, -2) + "l";
  if (t.endsWith("eis") && t.length > 5) return t.slice(0, -3) + "el";
  if (t.endsWith("ois") && t.length > 4) return t.slice(0, -2) + "l";
  // fornecedores → fornecedor, vezes → vez; mas livres → livre (consoante antes de "res").
  if ((t.endsWith("res") && /[aeiou]/.test(t.at(-4) ?? "")) || t.endsWith("zes")) return t.slice(0, -2);
  if (t.endsWith("ns")) return t.slice(0, -2) + "m";
  if (t.endsWith("is") || t.endsWith("us")) return t;
  return t.slice(0, -1);
}

/** Termos de busca: palavras normalizadas, sem palavras vazias, no singular. */
export function terms(text: string): string[] {
  return normalize(text)
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length >= 2 && !STOPWORDS.has(t))
    .map(singular);
}
