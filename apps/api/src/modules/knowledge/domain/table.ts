/**
 * Tabelas no Cérebro (N4): uma planilha CSV (enviada, do Drive ou de um banco somente leitura)
 * vira, além dos trechos com as linhas, um resumo CALCULADO pelo Aurora: contagem, soma, média,
 * mínimo e máximo de cada coluna numérica, no total e por categoria (por exemplo, "nota média por
 * canal"). Esses resumos entram na busca como trechos da própria fonte, então agentes e respostas
 * citam números de verdade, em vez de estimar a partir de algumas linhas.
 *
 * Determinístico, sem modelo: aceita vírgula ou ponto e vírgula, aspas, e decimal com vírgula.
 */

/**
 * Resumo extrativo de um documento (N4): as seções e a primeira frase de cada uma, até ~600
 * caracteres. Ajuda perguntas amplas ("compare as políticas") a achar cada documento inteiro, sem
 * modelo. Fica como trecho da própria fonte (com as mesmas permissões dela).
 */
export function documentSummary(title: string, text: string, max = 600): string | null {
  const lines = text.split("\n").map((l) => l.trim());
  const parts: string[] = [];
  let heading = "";
  let taken = false;
  for (const line of lines) {
    const h = /^#{1,4}\s+(.+)$/.exec(line);
    if (h) {
      heading = h[1]!.trim();
      taken = false;
      continue;
    }
    if (!line || taken) continue;
    const sentence = (/^(.{20,240}?[.!?])(\s|$)/.exec(line)?.[1] ?? line.slice(0, 240)).trim();
    parts.push(heading ? `${heading}: ${sentence}` : sentence);
    taken = true;
  }
  if (parts.length < 2) return null;
  let out = `Resumo de "${title}":`;
  for (const p of parts) {
    if ((out + " " + p).length > max) break;
    out += ` ${p}`;
  }
  return out;
}

export interface Table {
  columns: string[];
  rows: string[][];
}

/** Separador mais provável na primeira linha (o Excel em português usa ";"). */
function delimiterOf(header: string) {
  const count = (c: string) => header.split(c).length - 1;
  return count(";") > count(",") ? ";" : count("\t") > count(",") ? "\t" : ",";
}

/** CSV com aspas ("a, b" e "" dentro de aspas). Linhas vazias são ignoradas. */
export function parseCsv(text: string, maxRows = 50_000): Table {
  const clean = text.replace(/^﻿/, "");
  const firstLine = clean.slice(0, clean.indexOf("\n") === -1 ? undefined : clean.indexOf("\n"));
  const sep = delimiterOf(firstLine);
  const records: string[][] = [];
  let field = "";
  let record: string[] = [];
  let quoted = false;
  for (let i = 0; i < clean.length; i++) {
    const c = clean[i]!;
    if (quoted) {
      if (c === '"' && clean[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === sep) {
      record.push(field.trim());
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && clean[i + 1] === "\n") i++;
      record.push(field.trim());
      if (record.some((f) => f !== "")) records.push(record);
      record = [];
      field = "";
      if (records.length > maxRows) break;
    } else field += c;
  }
  record.push(field.trim());
  if (record.some((f) => f !== "")) records.push(record);
  const [columns = [], ...rows] = records;
  return { columns, rows: rows.slice(0, maxRows) };
}

/** Número em formato brasileiro ou internacional ("1.234,5", "1234.5", "R$ 10", "87%"). */
export function toNumber(raw: string): number | null {
  let v = raw.replace(/[R$\s%]/g, "");
  if (!v || !/^[-+]?[\d.,]+$/.test(v)) return null;
  if (v.includes(",") && v.includes(".")) v = v.lastIndexOf(",") > v.lastIndexOf(".") ? v.replace(/\./g, "").replace(",", ".") : v.replace(/,/g, "");
  else if (v.includes(",")) v = /,\d{3}$/.test(v) && !/^\d{1,3},\d{3},/.test(v) && v.split(",").length === 2 && v.length > 5 ? v.replace(",", "") : v.replace(",", ".");
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

const fmt = (n: number) => (Math.round(n * 100) / 100).toLocaleString("pt-BR", { maximumFractionDigits: 2 });

export interface ColumnProfile {
  name: string;
  kind: "number" | "category" | "text";
  filled: number;
  /** Números: estatísticas. */
  stats?: { count: number; sum: number; avg: number; min: number; max: number };
  /** Categorias: quantas linhas por valor (as mais frequentes). */
  counts?: [string, number][];
}

/** Coluna numérica: quase todos os valores preenchidos são números. Categoria: poucos valores distintos. */
export function profileTable(table: Table, maxCategories = 30): ColumnProfile[] {
  return table.columns.map((name, c) => {
    const values = table.rows.map((r) => r[c] ?? "").filter((v) => v !== "");
    const numbers = values.map(toNumber).filter((n): n is number => n !== null);
    if (values.length && numbers.length / values.length >= 0.9) {
      const sum = numbers.reduce((a, b) => a + b, 0);
      return { name, kind: "number", filled: values.length, stats: { count: numbers.length, sum, avg: sum / numbers.length, min: Math.min(...numbers), max: Math.max(...numbers) } };
    }
    const distinct = new Map<string, number>();
    for (const v of values) distinct.set(v, (distinct.get(v) ?? 0) + 1);
    if (values.length && distinct.size <= maxCategories && distinct.size < values.length)
      return { name, kind: "category", filled: values.length, counts: [...distinct.entries()].sort((a, b) => b[1] - a[1]) };
    return { name, kind: "text", filled: values.length };
  });
}

/**
 * O resumo calculado, em texto (um bloco por pergunta típica): visão geral da tabela, cada coluna
 * numérica e, para cada categoria, a média/soma das colunas numéricas por valor.
 */
export function tableSummaries(title: string, table: Table): { section: string; text: string }[] {
  if (!table.columns.length || !table.rows.length) return [];
  const profile = profileTable(table);
  const numeric = profile.filter((p) => p.kind === "number");
  const categories = profile.filter((p) => p.kind === "category");
  const out: { section: string; text: string }[] = [];
  out.push({
    section: "Resumo calculado",
    text: [
      `Tabela "${title}": ${table.rows.length.toLocaleString("pt-BR")} linhas e ${table.columns.length} colunas (${table.columns.join(", ")}). Valores calculados pelo Aurora a partir de todas as linhas.`,
      ...numeric.map((p) => `${p.name}: média ${fmt(p.stats!.avg)}, soma ${fmt(p.stats!.sum)}, mínimo ${fmt(p.stats!.min)}, máximo ${fmt(p.stats!.max)} (${p.stats!.count} valores).`),
      ...categories.map((p) => `${p.name}: ${p.counts!.slice(0, 15).map(([v, n]) => `${v} (${n})`).join(", ")}.`),
    ].join("\n"),
  });
  for (const cat of categories) {
    const c = table.columns.indexOf(cat.name);
    const lines: string[] = [];
    for (const [value] of cat.counts!.slice(0, 15)) {
      const rows = table.rows.filter((r) => (r[c] ?? "") === value);
      const parts = numeric.map((num) => {
        const n = table.columns.indexOf(num.name);
        const vals = rows.map((r) => toNumber(r[n] ?? "")).filter((x): x is number => x !== null);
        if (!vals.length) return null;
        const sum = vals.reduce((a, b) => a + b, 0);
        return `${num.name} média ${fmt(sum / vals.length)} e soma ${fmt(sum)}`;
      });
      lines.push(`${cat.name} = ${value}: ${rows.length} linha(s)${parts.filter(Boolean).length ? `; ${parts.filter(Boolean).join("; ")}` : ""}.`);
    }
    out.push({ section: `Por ${cat.name}`, text: [`Tabela "${title}", calculado pelo Aurora por ${cat.name}:`, ...lines].join("\n") });
  }
  return out;
}
