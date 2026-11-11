/**
 * Regras de texto da voz do Jarvis, separadas do navegador para serem testadas:
 *
 * - Palavra de ativação: "Jarvis" (com "ei", "ok" ou "oi" antes, opcional), tolerante às
 *   grafias que o reconhecimento de voz em português costuma devolver.
 * - Pedido para parar de falar ("para", "chega", "silêncio"…), só em frases curtas.
 * - Eco: o microfone continua aberto enquanto ele fala (para dar para interromper), então o que o
 *   reconhecimento devolve pode ser a própria voz dele saindo do alto-falante.
 * - Texto para falar: sem marcações, citações [1], endereços e identificadores.
 */

export const normalize = (text: string) =>
  text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();

// "jarvis", "jarvi", "djarvis", "jarves", "jarbas", "jervis", "harvis"…
const WAKE = /(?:^|\s)(?:(?:ei|hey|ok|oi|ola)\s+)?(?:d?j[ae]r?v[ie]s?|jarbas|harvis|jarves|javis)(?=\s|$)/;

/** Achou o nome? Devolve o que veio depois dele ("Jarvis, qual o resumo" → "qual o resumo"). */
export function findWake(text: string): { hit: boolean; trailing: string } {
  const n = normalize(text);
  const m = WAKE.exec(n);
  if (!m) return { hit: false, trailing: "" };
  return { hit: true, trailing: n.slice(m.index + m[0].length).trim() };
}

const STOP = /^(?:(?:jarvis\s+)?(?:para|pare|parar|chega|silencio|cancela|cancelar|espera|ok obrigado|obrigado|pode parar))(?:\s+jarvis)?$/;

/** "Para", "chega", "silêncio"… (frase curta: "para de comprar X" é um pedido, não um basta). */
export const isStop = (text: string) => STOP.test(normalize(text));

/**
 * O que foi ouvido é a voz dele? Considera eco quando quase todas as palavras ouvidas estão no
 * que ele está falando. Frases curtas demais não decidem (uma palavra coincide por acaso).
 */
export function isEcho(heard: string, speaking: string): boolean {
  const words = normalize(heard).split(" ").filter((w) => w.length > 2);
  if (!speaking || words.length < 2) return false;
  const said = new Set(normalize(speaking).split(" "));
  const inside = words.filter((w) => said.has(w)).length;
  return inside / words.length >= 0.7;
}

/** Texto bom para a voz: sem markdown, citações, endereços e ids longos. */
export function speakable(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/\[\d+\]/g, " ")
    .replace(/[*_#>`|]+/g, " ")
    .replace(/\b[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}\b/gi, " ")
    .replace(/\s+([,.;:!?])/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

/** Frases de até ~180 caracteres: o Chrome corta falas longas no meio. */
export function sentences(text: string, max = 180): string[] {
  const parts = text.match(/[^.!?…]+[.!?…]*\s*/g) ?? [text];
  const out: string[] = [];
  let cur = "";
  for (const p of parts) {
    if ((cur + p).length > max && cur) {
      out.push(cur.trim());
      cur = "";
    }
    cur += p;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}
