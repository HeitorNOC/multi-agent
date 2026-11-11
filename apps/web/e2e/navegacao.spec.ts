// Cada área do menu abre sem erro, no computador e no celular, e os selects ficam legíveis.
import { expect, test } from "@playwright/test";
import { watchErrors } from "./support";

const AREAS = [
  ["/", "Command Center"],
  ["/conversa", "Conversa"],
  ["/trabalhos", "Trabalhos"],
  ["/entregas", "Entregas"],
  ["/rotinas", "Rotinas"],
  ["/cerebro", "Cérebro"],
  ["/agentes", "Agentes"],
  ["/organograma", "Organograma"],
  ["/integracoes", "Integrações"],
  ["/governanca", "Governança"],
  ["/configuracoes", "Configurações"],
] as const;

for (const [path, title] of AREAS)
  test(`abre ${title}`, async ({ page }) => {
    const errors = watchErrors(page);
    await page.goto(path);
    await expect(page.getByRole("heading", { level: 1, name: title })).toBeVisible();
    // Nenhum aviso de falha da API na tela.
    await expect(page.getByText(/Não foi possível|Sem conexão com o Aurora/)).toHaveCount(0);
    // Nada passa da largura da tela (celular inclusive).
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow, "rolagem horizontal").toBeLessThanOrEqual(1);
    errors.assertClean();
  });

test("opções dos selects têm fundo e texto do tema (legíveis no escuro)", async ({ page }) => {
  await page.goto("/cerebro");
  const select = page.getByLabel("Procurar em");
  await expect(select).toBeVisible();
  const colors = await select.evaluate((el: HTMLSelectElement) => {
    const o = getComputedStyle(el.options[0]!);
    return { scheme: getComputedStyle(document.documentElement).colorScheme, bg: o.backgroundColor, fg: o.color };
  });
  expect(colors.scheme).toBe("dark");
  expect(colors.bg).not.toBe(colors.fg);
  expect(colors.bg).not.toMatch(/rgba\(0, 0, 0, 0\)|transparent/);
});
