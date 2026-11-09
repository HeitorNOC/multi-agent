import { expect, it, vi } from "vitest";

import type { PosScope } from "../../ports/terminal-payment";
import { ProcessTerminalPaymentWebhook } from "./process-terminal-payment-webhook";

it("verifies and processes a provider event without a user session", async () => {
  const confirmed = { id: "charge", status: "CONFIRMED" };
  const event = {
    eventId: "event-001",
    externalId: "external-charge",
    feeAmount: "1.0000",
    occurredAt: "2026-08-20T12:00:00.000Z",
    status: "CONFIRMED" as const,
  };
  const scope = {
    repository: { processProviderEvent: vi.fn().mockResolvedValue(confirmed) },
  } as unknown as PosScope;
  const service = new ProcessTerminalPaymentWebhook(
    { run: vi.fn(), runSystem: async (_organizationId, operation) => operation(scope) },
    {
      resolve: () => ({
        refund: vi.fn(),
        start: vi.fn(),
        verifyWebhook: vi.fn().mockResolvedValue({ chargeId: "charge", event }),
      }),
    },
  );
  await expect(
    service.execute({
      chargeId: "charge",
      organizationId: "organization",
      provider: "SANDBOX",
      rawBody: "{}",
      signature: "signature",
    }),
  ).resolves.toBe(confirmed);
  expect(scope.repository.processProviderEvent).toHaveBeenCalledWith("charge", "SANDBOX", event);
});

it("skips the unit of work when the provider ignores the event", async () => {
  const runSystem = vi.fn();
  const verifyWebhook = vi.fn().mockResolvedValue(null);
  const service = new ProcessTerminalPaymentWebhook(
    { run: vi.fn(), runSystem },
    {
      resolve: () => ({
        refund: vi.fn(),
        start: vi.fn(),
        verifyWebhook,
      }),
    },
  );
  await expect(
    service.execute({
      chargeId: "charge",
      organizationId: "organization",
      provider: "SANDBOX",
      rawBody: "{}",
      signature: "signature",
    }),
  ).resolves.toBeNull();
  expect(runSystem).not.toHaveBeenCalled();
});
