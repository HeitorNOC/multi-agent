/**
 * Testes de interface (Playwright): a API real servindo a interface construída, num banco
 * descartável. Rode `npm run build` antes (o `npm run test:ui` já faz isso).
 *
 * Navegador: no CI, o Chromium do Playwright; na máquina, o Chrome instalado (sem download).
 * `PLAYWRIGHT_CHANNEL=chromium` força o do Playwright.
 */
import { defineConfig, devices } from "@playwright/test";

const port = Number(process.env.AURORA_E2E_PORT ?? 4199);
const channel = process.env.PLAYWRIGHT_CHANNEL ?? (process.env.CI ? undefined : "chrome");

export default defineConfig({
  testDir: "e2e",
  // Um banco para todos os testes: cada um cria os próprios dados com nomes únicos.
  workers: 1,
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    locale: "pt-BR",
    timezoneId: "America/Sao_Paulo",
    colorScheme: "dark",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"], channel } },
    { name: "celular", use: { ...devices["Pixel 7"], channel }, testMatch: /navegacao\.spec\.ts/ },
  ],
  webServer: {
    command: "node e2e/serve.mjs",
    url: `http://127.0.0.1:${port}/api/settings`,
    reuseExistingServer: false,
    timeout: 60_000,
    stdout: "ignore",
    stderr: "pipe",
  },
});
