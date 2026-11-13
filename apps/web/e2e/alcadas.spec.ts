// N1 — alçadas do Chief of Staff e contratação proposta na conversa.
import { expect, test, type Page } from "@playwright/test";
import { api, BASE, watchErrors } from "./support";

const shot = async (page: Page, name: string) => {
  if (process.env.AURORA_E2E_SHOTS) await page.screenshot({ path: `${process.env.AURORA_E2E_SHOTS}/${name}.png`, fullPage: true });
};

const PEDIDO = "Quero uma campanha paga no Meta Ads e Google Ads, com testes de criativos, orçamento por públicos e leitura do ROAS.";

test("Configurações: alçadas do Chief, salvas e lidas de volta", async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto("/configuracoes");
  const card = page.locator("[data-slot=card]", { hasText: "Alçadas do Chief of Staff" });
  await expect(card).toBeVisible();
  const hire = card.getByRole("radiogroup", { name: "Trazer agente que falta" });
  await expect(hire.getByRole("radio", { name: "Propor e esperar você" })).toHaveAttribute("aria-checked", "true");
  await hire.getByRole("radio", { name: "Contratar sozinho" }).click();
  await card.getByLabel("Agentes por trabalho").fill("6");
  await card.getByRole("button", { name: "Salvar alçadas" }).click();
  await expect(card.getByText("Salvo.")).toBeVisible();
  await page.reload();
  await expect(card.getByRole("radiogroup", { name: "Trazer agente que falta" }).getByRole("radio", { name: "Contratar sozinho" })).toHaveAttribute("aria-checked", "true");
  await expect(card.getByLabel("Agentes por trabalho")).toHaveValue("6");
  await card.scrollIntoViewIfNeeded();
  await shot(page, "alcadas");
  // Volta ao padrão para os outros testes.
  await api(page, "/api/autonomy", { hire: "propose", max_agents: 8, engagement: "job" });
  errors.assertClean();
});

test("o Chief propõe quem falta; contratar abre o trabalho e o agente entra só para ele", async ({ page }) => {
  const errors = watchErrors(page);
  await api(page, "/api/autonomy", { hire: "propose", engagement: "job", areas: null });
  await api(page, "/api/agents/hire", { template_id: "financial_planning_analyst" });
  const { id } = await api<{ id: string }>(page, "/api/conversations", { title: "Campanha paga" });

  await page.goto(`/conversa/${id}`);
  await page.getByPlaceholder(/Escreva para o Chief of Staff/).fill(PEDIDO);
  await page.getByRole("button", { name: "Enviar" }).click();
  const card = page.getByLabel("Proposta de contratação");
  await expect(card).toBeVisible();
  await expect(card).toContainText("Gestor de tráfego pago");
  await expect(card).toContainText("só para este trabalho");
  await expect(page.getByText(/Proponho trazer/)).toBeVisible();
  await shot(page, "proposta-contratacao");

  await card.getByRole("button", { name: "Contratar e seguir" }).click();
  await expect(card.getByText("Você aprovou a contratação.")).toBeVisible();
  await expect(page.getByText(/^Combinado\. Trouxe .* só para este trabalho/)).toBeVisible();
  await expect(card.getByRole("link", { name: "Ver o trabalho" })).toBeVisible();
  await shot(page, "proposta-aceita");

  // No time: aparece como "Só neste trabalho" e trazido pelo Chief.
  await page.goto("/agentes");
  const row = page.getByRole("list", { name: "Lista operacional dos agentes" }).locator("li").filter({ hasText: "Gestor de tráfego pago" });
  await expect(row.getByRole("link", { name: "Só neste trabalho" })).toBeVisible();
  await expect(row).toContainText("trazido pelo Chief");
  errors.assertClean();

  // Limpeza: tira do time para não interferir nos outros testes.
  const team = (await (await page.request.get(`${BASE}/api/agents`)).json()) as { agents: { id: string }[] };
  if (team.agents.some((a) => a.id === "paid_traffic_manager")) await api(page, "/api/agents/paid_traffic_manager/remove");
});

test("catálogo mostra a Diretoria de cada área", async ({ page }) => {
  await page.goto("/agentes?aba=catalogo");
  await expect(page.getByText("Diretoria").first()).toBeVisible();
  await expect(page.getByText("Diretor de tecnologia")).toBeVisible();
});
