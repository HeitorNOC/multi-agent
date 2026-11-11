// Cérebro: escrever uma fonte, perguntar com citação, gerenciar áreas e criar área no envio.
import { expect, test } from "@playwright/test";
import { addText, api, unique, watchErrors } from "./support";

test("escrever uma fonte e perguntar: a resposta cita a fonte", async ({ page }) => {
  const errors = watchErrors(page);
  const title = unique("Política de reembolso");
  await page.goto("/cerebro");
  await page.getByRole("button", { name: "Adicionar ao Cérebro" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("tab", { name: /Escrever texto/ }).click();
  await dialog.getByRole("textbox").first().fill("# Reembolso\n\nDespesas de viagem são reembolsadas em até 10 dias úteis, com nota fiscal.");
  await dialog.getByLabel("Título").fill(title);
  await dialog.getByRole("button", { name: "Adicionar", exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByRole("button", { name: new RegExp(title) })).toBeVisible();

  await page.getByPlaceholder(/Quem aprova compras/).fill("Em quantos dias as despesas de viagem são reembolsadas?");
  await page.getByRole("button", { name: "Perguntar" }).click();
  await expect(page.locator("ol li").filter({ hasText: title }).first()).toBeVisible();
  errors.assertClean();
});

test("áreas: criar, renomear, ver em uso e excluir", async ({ page }) => {
  const name = unique("Jurídico");
  const renamed = unique("Contratos");
  await page.goto("/cerebro");
  await page.getByRole("button", { name: "Áreas", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Nome da nova área").fill(name);
  await dialog.getByRole("button", { name: "Criar" }).click();
  const row = dialog.locator("li").filter({ hasText: name });
  await expect(row).toBeVisible();
  // Nome repetido é recusado com aviso.
  await dialog.getByLabel("Nome da nova área").fill(name.toUpperCase());
  await dialog.getByRole("button", { name: "Criar" }).click();
  await expect(dialog.getByText(/Já existe a área/)).toBeVisible();
  await dialog.getByLabel("Nome da nova área").fill("");

  await row.getByRole("button", { name: "Renomear" }).click();
  await dialog.getByLabel(`Novo nome de ${name}`).fill(renamed);
  await dialog.getByRole("button", { name: "Salvar nome" }).click();
  const renamedRow = dialog.locator("li").filter({ hasText: renamed });
  await expect(renamedRow).toBeVisible();

  // Excluir pede confirmação; cancelar mantém a área.
  await renamedRow.getByRole("button", { name: "Excluir" }).click();
  await renamedRow.getByRole("button", { name: "Cancelar" }).click();
  await expect(renamedRow).toBeVisible();
  await renamedRow.getByRole("button", { name: "Excluir" }).click();
  await renamedRow.getByRole("button", { name: "Excluir área" }).click();
  await expect(dialog.locator("li").filter({ hasText: renamed })).toHaveCount(0);
  // Áreas fixas não têm ações.
  await expect(dialog.locator("li").filter({ hasText: /^Geral/ }).getByText("Fixa")).toBeVisible();
});

test("área com fonte em vigor não pode ser excluída", async ({ page }) => {
  const area = unique("Comercial");
  await page.goto("/cerebro");
  const { id } = await api<{ id: string }>(page, "/api/knowledge/areas", { title: area });
  await addText(page, unique("Tabela de preços"), undefined, id);
  await page.reload();
  await page.getByRole("button", { name: "Áreas", exact: true }).click();
  const row = page.getByRole("dialog").locator("li").filter({ hasText: area });
  await expect(row.getByText("1 fonte")).toBeVisible();
  await expect(row.getByText("Em uso")).toBeVisible();
  await expect(row.getByRole("button", { name: "Excluir" })).toHaveCount(0);
});

test("ao adicionar uma fonte, “+ Nova área…” cria e já seleciona a área", async ({ page }) => {
  const area = unique("Operações");
  await page.goto("/cerebro");
  await page.getByRole("button", { name: "Adicionar ao Cérebro" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Área", { exact: true }).selectOption("__new__");
  await dialog.getByLabel("Nome da nova área").fill(area);
  // Enter cria a área sem enviar o formulário da fonte.
  await dialog.getByLabel("Nome da nova área").press("Enter");
  // O campo da nova área fecha quando a API confirma; aí a área já está escolhida.
  await expect(dialog.getByLabel("Nome da nova área")).toHaveCount(0);
  const select = dialog.getByLabel("Área", { exact: true });
  await expect(select).toHaveValue(/operacoes/);
  await expect(select.locator("option:checked")).toHaveText(area);
  await expect(dialog).toBeVisible();
});
