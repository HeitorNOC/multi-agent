// N5 — memória da empresa (Configurações) e da conversa (decisões registradas).
import { expect, test } from "@playwright/test";
import { api, unique, watchErrors } from "./support";

test("memória da empresa: adicionar, editar e remover um fato", async ({ page }) => {
  const errors = watchErrors(page);
  const fact = unique("Vendemos materiais de construção");
  await page.goto("/configuracoes");
  const card = page.locator("[data-slot=card]", { hasText: "Memória da empresa" });
  await card.getByLabel("Categoria do fato").selectOption("produtos");
  await card.getByLabel("Novo fato").fill(fact);
  await card.getByRole("button", { name: "Adicionar" }).click();
  const row = card.getByRole("list", { name: "Fatos da empresa" }).locator("li").filter({ hasText: fact });
  await expect(row).toContainText("Produtos");
  await row.getByRole("button", { name: `Editar ${fact}` }).click();
  await card.getByLabel("Texto do fato").fill(`${fact} e ferramentas`);
  await card.getByRole("button", { name: "Salvar" }).click();
  const edited = card.locator("li").filter({ hasText: `${fact} e ferramentas` });
  await expect(edited).toBeVisible();
  await edited.getByRole("button", { name: "Remover" }).click();
  await edited.getByRole("button", { name: "Remover fato" }).click();
  await expect(card.locator("li").filter({ hasText: fact })).toHaveCount(0);
  errors.assertClean();
});

test("memória da conversa: decisão afirmada aparece na Memória e responde 'o que decidimos?'", async ({ page }) => {
  const errors = watchErrors(page);
  const { id } = await api<{ id: string }>(page, "/api/conversations", { title: unique("Decisões") });
  await page.goto(`/conversa/${id}`);
  const box = page.getByPlaceholder(/Escreva para o Chief of Staff/);
  await box.fill("Fica decidido que vamos usar Kafka para os eventos do WebChat.");
  await page.getByRole("button", { name: "Enviar" }).click();
  await expect(page.getByRole("button", { name: /Memória da conversa: 1 decisão/ })).toBeVisible();
  await box.fill("O que decidimos até agora?");
  await page.getByRole("button", { name: "Enviar" }).click();
  await expect(page.getByText(/^Até aqui ficou decidido: 1\) Fica decidido que vamos usar Kafka/)).toBeVisible();
  await page.getByRole("button", { name: /Memória da conversa/ }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("list", { name: "Decisões registradas" })).toContainText("Combinado na conversa");
  errors.assertClean();
});
