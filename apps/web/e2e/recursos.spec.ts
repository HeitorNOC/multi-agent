// N6 — recursos da empresa e conectores de ação (GitHub, WhatsApp, Página do Facebook).
import { expect, test } from "@playwright/test";
import { unique, watchErrors } from "./support";

test("recursos da empresa: cadastrar e remover; senha na descrição é recusada", async ({ page }) => {
  // A recusa (400) é provocada de propósito; o console do navegador a registra como erro.
  const errors = watchErrors(page);
  const name = unique("Kafka");
  await page.goto("/integracoes");
  const card = page.locator("[data-slot=card]", { hasText: "Recursos da empresa" });
  await card.getByLabel("Tipo do recurso").selectOption("queue");
  await card.getByLabel("Nome do recurso").fill(name);
  await card.getByLabel("Descrição do recurso").fill("Cluster kafka.interno:9092; tópicos atendimento.*");
  await card.getByRole("button", { name: "Adicionar recurso" }).click();
  const row = card.getByRole("list", { name: "Recursos cadastrados" }).locator("li").filter({ hasText: name });
  await expect(row).toContainText("Fila / mensageria");

  await card.getByLabel("Nome do recurso").fill(unique("Réplica"));
  await card.getByLabel("Descrição do recurso").fill("postgres://leitor:segredo@host:5432/banco");
  await card.getByRole("button", { name: "Adicionar recurso" }).click();
  await expect(card.getByText(/parece ter uma senha ou token/)).toBeVisible();

  await row.getByRole("button", { name: "Remover" }).click();
  await row.getByRole("button", { name: "Remover recurso" }).click();
  await expect(card.locator("li").filter({ hasText: name })).toHaveCount(0);
  void errors;
});

test("conectores de ação disponíveis, cada um com os próprios campos", async ({ page }) => {
  await page.goto("/integracoes");
  for (const name of ["GitHub", "WhatsApp Business", "Página do Facebook"]) await expect(page.getByText(name, { exact: true }).first()).toBeVisible();
  await page.getByRole("button", { name: "Conectar GitHub" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByLabel("Token de acesso (fine-grained)")).toBeVisible();
  await expect(dialog.getByLabel("Repositório", { exact: true })).toBeVisible();
  await expect(dialog.getByLabel("Branch base (opcional)")).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Conectar", exact: true })).toBeDisabled();
});
