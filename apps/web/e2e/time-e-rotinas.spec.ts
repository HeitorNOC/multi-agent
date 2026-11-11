// Time de agentes e rotinas: criar, ajustar e tirar/arquivar com confirmação.
import { expect, test } from "@playwright/test";
import { unique, watchErrors } from "./support";

test("criar meu agente, ajustar e tirar do time", async ({ page }) => {
  const errors = watchErrors(page);
  const name = unique("Rita");
  await page.goto("/agentes");
  await page.getByRole("button", { name: "Criar meu agente" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Nome", { exact: true }).fill(name);
  await dialog.getByLabel("Cargo").fill("Analista fiscal");
  await dialog.getByLabel("Área").selectOption({ index: 1 });
  await dialog.getByLabel("No que ajuda").fill("Tributos, obrigações acessórias e prazos fiscais");
  await dialog.getByRole("button", { name: "Criar e colocar no time" }).click();
  await expect(dialog).toBeHidden();

  await page.getByRole("tab", { name: /No seu time/ }).click();
  await page.getByRole("button", { name: `Ajustar ${name}` }).click();
  const edit = page.getByRole("dialog");
  await edit.getByLabel("Orientações da empresa").fill("Sempre indique a norma aplicável.");
  await edit.getByRole("button", { name: "Salvar" }).click();
  await expect(edit).toBeHidden();
  await expect(page.locator("li").filter({ hasText: name }).getByText(/com orientações/)).toBeVisible();

  await page.getByRole("button", { name: `Ajustar ${name}` }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Tirar do time" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Confirmar" }).click();
  await expect(page.getByRole("dialog")).toBeHidden();
  await expect(page.getByRole("button", { name: `Ajustar ${name}` })).toHaveCount(0);
  errors.assertClean();
});

test("criar rotina, pausar e arquivar", async ({ page }) => {
  const errors = watchErrors(page);
  const name = unique("Resumo de compras");
  await page.goto("/rotinas");
  await page.getByRole("button", { name: "Nova rotina" }).first().click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Nome").fill(name);
  await dialog.getByLabel("Pedido ao Chief of Staff").fill("Resuma as compras do dia anterior e aponte o que foge da política.");
  await dialog.getByRole("radio", { name: "Por intervalo" }).click();
  await dialog.getByLabel("Intervalo").selectOption({ label: "A cada 2 h" });
  await dialog.getByRole("button", { name: "Criar rotina" }).click();
  await expect(dialog).toBeHidden();

  const card = page.locator("li").filter({ hasText: name });
  await expect(card.getByText("Ativa")).toBeVisible();
  await card.getByRole("button", { name: "Pausar" }).click();
  await expect(card.getByText("Pausada")).toBeVisible();

  await card.getByRole("button", { name: "Histórico" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Arquivar" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Arquivar rotina" }).click();
  await expect(page.getByRole("dialog")).toBeHidden();
  await expect(page.locator("li").filter({ hasText: name })).toHaveCount(0);
  errors.assertClean();
});
