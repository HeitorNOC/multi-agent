/**
 * Extração de texto de PDF e Word (.docx), em JavaScript puro (pdf.js e mammoth), sem serviço
 * externo e sem executar nada do arquivo.
 *
 * - PDF: texto de cada página, na ordem de leitura; páginas separadas por parágrafo. Um PDF só de
 *   imagens (escaneado) não tem texto e é recusado com uma mensagem que diz o que fazer.
 * - Word: o texto dos parágrafos (sem imagens nem formatação).
 * Os demais formatos são de texto e são lidos pelo domínio (`extractText`).
 */
import { invalid } from "../../../shared/errors.ts";
import { cleanText, ensureSupported, extractText } from "../domain/text.ts";

export type TextExtractor = (bytes: Uint8Array, mediaType: string) => Promise<string>;

const PDF = "application/pdf";
const DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

export const extractDocumentText: TextExtractor = async (bytes, mediaType) => {
  if (ensureSupported(mediaType).kind === "text") return extractText(bytes, mediaType);
  if (mediaType === PDF) return pdfText(bytes);
  if (mediaType === DOCX) return docxText(bytes);
  return extractText(bytes, mediaType);
};

async function pdfText(bytes: Uint8Array): Promise<string> {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  let doc;
  try {
    // Sem `eval`, sem fontes do sistema e sem baixar nada: só leitura do texto.
    doc = await pdfjs.getDocument({ data: new Uint8Array(bytes), isEvalSupported: false, disableFontFace: true, useSystemFonts: false, verbosity: 0 })
      .promise;
  } catch {
    throw invalid("invalid_pdf", "Não foi possível ler este PDF (arquivo danificado ou protegido por senha)");
  }
  try {
    const pages: string[] = [];
    for (let n = 1; n <= doc.numPages; n++) {
      const content = await (await doc.getPage(n)).getTextContent();
      let page = "";
      for (const item of content.items) {
        if (!("str" in item)) continue;
        page += item.str + (item.hasEOL ? "\n" : "");
      }
      pages.push(page);
    }
    const text = pages.join("\n\n");
    if (!text.replace(/\s/g, "")) throw invalid("pdf_without_text", "Este PDF não tem texto (parece escaneado). Envie a versão com texto ou um arquivo Word/TXT.");
    return cleanText(text);
  } finally {
    await doc.destroy();
  }
}

async function docxText(bytes: Uint8Array): Promise<string> {
  const mammoth = (await import("mammoth")).default;
  try {
    const { value } = await mammoth.extractRawText({ buffer: Buffer.from(bytes) });
    return cleanText(value);
  } catch (error) {
    if (error instanceof Error && error.name === "AppError") throw error;
    throw invalid("invalid_docx", "Não foi possível ler este arquivo Word (.docx)");
  }
}
