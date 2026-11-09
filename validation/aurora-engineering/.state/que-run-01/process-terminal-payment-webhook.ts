import type { PaymentChargeView, TerminalProvider } from "@gestor/contracts";
import { NotFoundError } from "@gestor/kernel";

import type { PosUnitOfWork, TerminalProviderRegistry } from "../../ports/terminal-payment";

export class ProcessTerminalPaymentWebhook {
  constructor(
    private readonly unitOfWork: PosUnitOfWork,
    private readonly providers: TerminalProviderRegistry,
  ) {}

  execute(input: {
    chargeId?: string;
    dataId?: string;
    organizationId: string;
    provider: TerminalProvider;
    rawBody: string;
    requestId?: string;
    signature: string;
  }): Promise<PaymentChargeView | null> {
    return this.process(input);
  }

  private async process(input: {
    chargeId?: string;
    dataId?: string;
    organizationId: string;
    provider: TerminalProvider;
    rawBody: string;
    requestId?: string;
    signature: string;
  }): Promise<PaymentChargeView | null> {
    const verified = await this.providers
      .resolve(input.provider)
      .verifyWebhook(input.rawBody, input.signature, {
        organizationId: input.organizationId,
        ...(input.chargeId ? { chargeId: input.chargeId } : {}),
        ...(input.dataId ? { dataId: input.dataId } : {}),
        ...(input.requestId ? { requestId: input.requestId } : {}),
      });
    if (!verified) return this.unitOfWork.runSystem(input.organizationId, async () => null);
    if (input.chargeId && verified.chargeId !== input.chargeId)
      throw new NotFoundError("PAYMENT_CHARGE_NOT_FOUND", "A cobrança não foi encontrada.");
    return this.unitOfWork.runSystem(input.organizationId, async (scope) => {
      const charge = await scope.repository.processProviderEvent(
        verified.chargeId,
        input.provider,
        verified.event,
      );
      if (!charge)
        throw new NotFoundError("PAYMENT_CHARGE_NOT_FOUND", "A cobrança não foi encontrada.");
      return charge;
    });
  }
}
