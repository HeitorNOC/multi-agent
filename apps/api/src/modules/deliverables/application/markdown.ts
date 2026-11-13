/** A entrega como documento Markdown: resumo, recomendação, achados com citações e fontes. */
export interface DeliverableContent {
  goal: string;
  report: {
    abstained?: boolean;
    summary?: string;
    recommendation?: string;
    findings?: { agent: string; claim: string; citations: string[] }[];
    citations?: { label: string; title?: string; source: string; version: number; url?: string }[];
    unknowns?: string[];
  };
  payload: { recipient?: string; content?: string };
}

const line = (text: string) => text.replace(/\r?\n/g, " ").trim();

export function toMarkdown(title: string, version: number, createdAt: string, content: DeliverableContent): string {
  const r = content.report ?? {};
  const citations = r.citations ?? [];
  const n = new Map(citations.map((c, i) => [c.label, i + 1]));
  const refs = (labels: string[]) => labels.map((l) => n.get(l)).filter((x) => x !== undefined).map((x) => `[${x}]`).join("");
  const out = [`# ${line(title)}`, "", `Versão ${version} · ${createdAt.slice(0, 10)}`, "", "## Pedido", "", content.goal.trim(), ""];
  if (r.abstained) out.push("> Sem evidência suficiente no Cérebro para recomendar.", "");
  if (r.summary) out.push("## Resumo", "", r.summary.trim(), "");
  if (r.recommendation) out.push("## Recomendação", "", r.recommendation.trim(), "");
  if (r.findings?.length) {
    out.push("## Achados", "");
    for (const f of r.findings) out.push(`- **${line(f.agent)}**: ${line(f.claim)} ${refs(f.citations)}`.trimEnd());
    out.push("");
  }
  if (r.unknowns?.length) {
    out.push("## Em aberto", "");
    for (const u of r.unknowns) out.push(`- ${line(u)}`);
    out.push("");
  }
  if (citations.length) {
    out.push("## Fontes", "");
    citations.forEach((c, i) => out.push(`${i + 1}. ${line(c.title ?? c.source)}, versão ${c.version}${c.url ? ` (${c.url})` : ""}`));
    out.push("");
  }
  return out.join("\n");
}
