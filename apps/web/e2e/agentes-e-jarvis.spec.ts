// Agentes em três vistas (lista operacional, mapa 3D e organograma) e o Jarvis (3D em tela cheia
// com a conversa do Chief of Staff por cima).
import { expect, test, type Page } from "@playwright/test";
import { api, watchErrors } from "./support";

/** Com AURORA_E2E_SHOTS=<pasta>, guarda uma captura de cada vista (conferência visual). */
const shot = async (page: Page, name: string) => {
  if (process.env.AURORA_E2E_SHOTS) await page.screenshot({ path: `${process.env.AURORA_E2E_SHOTS}/${name}.png` });
};

type Catalog = { areas: { id: string; templates: { id: string; name: string }[] }[] };

/** Contrata dois especialistas de uma área, o segundo respondendo ao primeiro. */
async function team(page: Page) {
  const catalog = (await (await page.request.get("/api/agents/catalog")).json()) as Catalog;
  const area = catalog.areas.find((a) => a.templates.length >= 2)!;
  const [lead, member] = [
    await api<{ id: string; name: string }>(page, "/api/agents/hire", { template_id: area.templates[0]!.id }),
    await api<{ id: string; name: string }>(page, "/api/agents/hire", { template_id: area.templates[1]!.id }),
  ];
  await api(page, `/api/agents/${member.id}`, { reports_to: lead.id });
  return { lead, member };
}

test("lista operacional: Chief of Staff primeiro e cada agente com status, atividade e marcos", async ({ page }) => {
  const errors = watchErrors(page);
  const { lead, member } = await team(page);
  await page.goto("/agentes");
  await expect(page.getByRole("radiogroup", { name: "Como ver o time" }).getByRole("radio", { name: "Lista" })).toHaveAttribute("aria-checked", "true");
  const list = page.getByRole("list", { name: "Lista operacional dos agentes" });
  await expect(list.locator("li").first()).toContainText("Chief of Staff");
  await expect(list.locator("li").first()).toContainText(/Pronto para um novo pedido|Coordenando|Pedido na fila|Montando/);
  const row = list.locator("li").filter({ hasText: member.name });
  await expect(row).toContainText(`responde a ${lead.name}`);
  await expect(row).toContainText("Disponível");
  await shot(page, "agentes-lista");
  errors.assertClean();
});

test("organograma: cartões ligados por setas, na horizontal e na vertical (a escolha fica guardada)", async ({ page }) => {
  const errors = watchErrors(page);
  const { lead, member } = await team(page);
  await page.goto("/agentes");
  await page.getByRole("radio", { name: "Organograma" }).click();
  await expect(page).toHaveURL(/vista=organograma/);
  const cards = page.getByRole("list", { name: "Cartões do organograma" });
  await expect(cards.getByRole("button", { name: "Conversar com o Chief of Staff" })).toBeVisible();
  await expect(cards.getByRole("button", { name: `Abrir a Estação de ${member.name}` })).toBeVisible();
  // Ligações com seta: no mínimo Chief → líder e líder → subordinado.
  expect(await page.locator("svg path[marker-end]").count()).toBeGreaterThanOrEqual(2);

  const box = async (name: string) => (await cards.getByRole("button", { name }).boundingBox())!;
  const chief = await box("Conversar com o Chief of Staff");
  const leader = await box(`Abrir a Estação de ${lead.name}`);
  expect(leader.x, "horizontal: o líder fica à direita do Chief").toBeGreaterThan(chief.x + chief.width);
  await shot(page, "agentes-organograma-horizontal");

  await page.getByRole("radio", { name: /Vertical/ }).click();
  const chiefV = await box("Conversar com o Chief of Staff");
  const leaderV = await box(`Abrir a Estação de ${lead.name}`);
  expect(leaderV.y, "vertical: o líder fica abaixo do Chief").toBeGreaterThan(chiefV.y + chiefV.height);
  await shot(page, "agentes-organograma-vertical");
  await page.reload();
  await expect(page.getByRole("radio", { name: /Vertical/ })).toHaveAttribute("aria-checked", "true");
  // O endereço antigo leva à mesma vista.
  await page.goto("/organograma");
  await expect(page).toHaveURL(/\/agentes\?vista=organograma/);
  errors.assertClean();
});

test("mapa 3D dos agentes: Chief of Staff no núcleo e os agentes do time", async ({ page }) => {
  const errors = watchErrors(page);
  const { member } = await team(page);
  await page.goto("/agentes?vista=mapa");
  const canvas = page.locator("canvas");
  await expect(canvas).toBeVisible();
  const labels = page.locator("[data-slot=map-labels] > div");
  await expect(labels.filter({ hasText: /^Chief of Staff$/ })).toHaveCount(1);
  await expect(labels.filter({ hasText: member.name }).first()).toBeAttached();
  expect((await canvas.boundingBox())!.height).toBeGreaterThan(300);
  await page.waitForTimeout(1500);
  await shot(page, "agentes-mapa-3d");
  errors.assertClean();
});

test("Jarvis: reator no centro, painel de sistemas, conversa por cima e tela cheia", async ({ page }) => {
  const errors = watchErrors(page);
  const { lead } = await team(page);
  await page.goto("/jarvis");
  await expect(page.getByRole("heading", { level: 1, name: "Jarvis" })).toBeAttached();
  await expect(page.locator("canvas")).toBeVisible();
  // O núcleo é o reator (sem rótulo); os agentes do time estão na rede.
  const labels = page.locator("[data-slot=map-labels] > div");
  await expect(labels.filter({ hasText: /^Chief of Staff$/ })).toHaveCount(0);
  await expect(labels.filter({ hasText: lead.name }).first()).toBeAttached();

  // Painel da esquerda: hora, sistemas e pendências.
  const hud = page.getByRole("complementary", { name: "Painel do Jarvis" });
  await expect(hud).toContainText("Jarvis · Chief of Staff");
  await expect(hud).toContainText("Sistemas");
  await expect(hud).toContainText(/Modelo\s*desligado · respostas por regras/);
  await expect(hud.getByText(/agente\(s\) · \d+ trabalhando/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Falar com o Jarvis" })).toContainText(/Voz desligada|Em espera/);

  // Sugestão: o Chief responde com a situação da empresa (por regras nos testes).
  const panel = page.getByRole("complementary", { name: "Conversa com o Jarvis" });
  await panel.getByRole("button", { name: "Nova conversa" }).click();
  await expect(page).toHaveURL(/conversa=/);
  await hud.getByRole("button", { name: "Me dá o resumo do dia" }).click();
  await expect(page.locator("[aria-live=polite]")).toContainText(/trabalho|Nada esperando/);
  await expect(panel.getByText("Me dá o resumo do dia")).toBeVisible();
  await expect(panel.getByText(/Ninguém do time está trabalhando agora|Trabalhando agora/)).toBeVisible();
  await page.waitForTimeout(800);
  await shot(page, "jarvis");

  // Pergunta escrita no painel: pendências.
  await panel.getByPlaceholder(/Escreva para o Chief of Staff/).fill("O que está esperando minha aprovação?");
  await panel.getByRole("button", { name: "Enviar" }).click();
  await expect(panel.getByText(/Nada esperando sua decisão agora|aguardando sua aprovação/).last()).toBeVisible();

  // Esconder e mostrar a conversa.
  await panel.getByRole("button", { name: "Esconder conversa" }).click();
  await expect(panel).toBeHidden();
  await page.getByRole("button", { name: "Conversar" }).click();
  await expect(panel).toBeVisible();
  await expect(page.getByRole("button", { name: /Ligar a voz|Religar a voz/ })).toBeAttached();

  await page.getByRole("button", { name: "Tela cheia" }).click();
  await expect(page.getByRole("button", { name: "Sair da tela cheia" })).toBeVisible();
  await page.waitForTimeout(500);
  await shot(page, "jarvis-tela-cheia");
  await page.getByRole("button", { name: "Sair da tela cheia" }).click();
  await expect(page.getByRole("button", { name: "Tela cheia" })).toBeVisible();
  errors.assertClean();
});
