/** Ajudas dos testes de interface: nomes únicos, dados preparados pela API e erros da página. */
import { expect, type Page } from "@playwright/test";

let n = 0;
/** Nome que não colide com o de outro teste no mesmo banco. */
export const unique = (prefix: string) => `${prefix} ${Date.now().toString(36)}${(n++).toString(36)}`;

/** Endereço da API de teste (o mesmo `baseURL` do config). */
export const BASE = `http://127.0.0.1:${process.env.AURORA_E2E_PORT ?? 4199}`;

/** POST como o navegador faria: a API confere a origem dos pedidos de escrita. */
export async function api<T>(page: Page, path: string, data: unknown = {}): Promise<T> {
  const res = await page.request.post(BASE + path, { data, headers: { origin: BASE, "idempotency-key": unique("k") } });
  expect(res.ok(), `${path}: ${res.status()} ${await res.text()}`).toBeTruthy();
  return (await res.json()) as T;
}

/** Fonte de texto no Cérebro (aberta a todos; área Geral se nenhuma for dada). */
export const addText = (page: Page, title: string, text = `# ${title}\n\nTexto de exemplo sobre ${title}.`, area?: string) =>
  api<{ id: string }>(page, "/api/knowledge/sources", { title, text, ...(area ? { area } : {}) });

/** Coleta erros do console, da página e respostas 5xx da API; `assertClean()` no fim. */
export function watchErrors(page: Page) {
  const errors: string[] = [];
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("response", (r) => {
    if (r.url().includes("/api/") && r.status() >= 500) errors.push(`${r.status()} ${r.url()}`);
  });
  return { assertClean: () => expect(errors, "erros na página").toEqual([]) };
}
