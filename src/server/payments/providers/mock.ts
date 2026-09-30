import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import type { PaymentProvider, ProviderEvent, ProviderEventType } from "./types.ts";

/**
 * DEMO PROVIDER. Moves no money.
 *
 * It behaves like a real gateway from the payment service's point of view:
 * orders get a provider reference, outcomes arrive as HMAC-signed webhooks that
 * go through exactly the same handler as production webhooks, duplicate
 * deliveries can be simulated, and refunds are reported back.
 */

const secret = () => process.env.MOCK_WEBHOOK_SECRET ?? "demo-mock-webhook-secret";

export function signMock(body: string): string {
  return createHmac("sha256", secret()).update(body).digest("hex");
}

export function buildMockEvent(input: {
  type: ProviderEventType;
  orderRef: string;
  amountPaise?: number;
  eventId?: string;
  reason?: string;
}): { body: string; signature: string } {
  const body = JSON.stringify({
    id: input.eventId ?? `mockevt_${randomUUID()}`,
    type: input.type,
    order_ref: input.orderRef,
    payment_ref: `mockpay_${input.orderRef.slice(-12)}`,
    amount: input.amountPaise,
    reason: input.reason,
  });
  return { body, signature: signMock(body) };
}

export const mockProvider: PaymentProvider = {
  name: "mock",
  isTestMode: true,

  async createOrder({ paymentId, totalPaise }) {
    return {
      orderRef: `mockord_${paymentId}`,
      clientData: { demo: true, totalPaise },
    };
  },

  async refund({ orderRef }) {
    return { status: "processed", refundRef: `mockrfnd_${orderRef.slice(-12)}` };
  },

  parseWebhook(rawBody, headers): ProviderEvent {
    const sig = headers.get("x-mock-signature") ?? "";
    const expected = signMock(rawBody);
    const a = Buffer.from(sig);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !timingSafeEqual(a, b)) throw new Error("Invalid webhook signature");
    const j = JSON.parse(rawBody);
    return {
      eventId: String(j.id),
      type: j.type,
      orderRef: String(j.order_ref),
      paymentRef: j.payment_ref ? String(j.payment_ref) : undefined,
      amountPaise: typeof j.amount === "number" ? j.amount : undefined,
      reason: j.reason,
      raw: j,
    };
  },
};
