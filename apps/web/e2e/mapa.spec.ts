// Mapa 3D do Cérebro: abre, desenha todos os rótulos (inclusive o do núcleo) e leva ao documento.
import { expect, test } from "@playwright/test";
import { addText, unique } from "./support";

test("mapa 3D mostra núcleo, áreas e documentos, e o Ir para… abre o documento", async ({ page }) => {
  const title = unique("Mapa");
  await addText(page, title);
  await page.goto("/cerebro?vista=mapa");
  const map = page.locator("section", { has: page.locator("canvas") });
  await expect(map.locator("canvas")).toBeVisible();

  // Rótulos ficam na camada sobre o canvas; nenhum pode nascer vazio (o do núcleo sumia).
  const labels = map.locator("[data-slot=map-labels] > div");
  await expect(labels.filter({ hasText: /^Cérebro$/ })).toHaveCount(1);
  await expect(labels.filter({ hasText: title })).toHaveCount(1);
  await expect(labels.filter({ hasText: /^Geral/ })).toHaveCount(1);
  for (const text of await labels.allTextContents()) expect(text.trim(), "rótulo vazio no mapa").not.toBe("");

  await map.getByLabel("Ir para").selectOption({ label: title });
  await expect(page.getByRole("dialog").getByText(title, { exact: false }).first()).toBeVisible();
});
