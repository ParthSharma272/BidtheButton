/**
 * The narrow surface THE BUTTON needs from a payment provider. Everything
 * provider-specific (signatures, payload shapes) is translated into
 * `ProviderEvent` at the edge, so the payment service never sees raw payloads.
 */

export type ProviderEventType =
  | "payment.processing"
  | "payment.captured"
  | "payment.failed"
  | "refund.processed"
  | "refund.failed";

export interface ProviderEvent {
  /** Unique per event from the provider. The dedupe key for webhook idempotency. */
  eventId: string;
  type: ProviderEventType;
  /** Our order reference as known to the provider. */
  orderRef: string;
  /** The provider's id for the charge itself (needed for refunds). */
  paymentRef?: string;
  /** Amount the provider says it captured, in paise. */
  amountPaise?: number;
  reason?: string;
  raw: unknown;
}

export interface CreateOrderResult {
  orderRef: string;
  /** Data the browser needs to open the provider's checkout UI. */
  clientData: Record<string, unknown>;
}

export interface RefundResult {
  /** "processed": money is on its way back now. "pending": wait for refund.processed. */
  status: "processed" | "pending";
  refundRef?: string;
}

export interface PaymentProvider {
  name: "mock" | "razorpay";
  isTestMode: boolean;
  createOrder(input: { paymentId: string; totalPaise: number; currency: "INR"; description: string }): Promise<CreateOrderResult>;
  refund(input: { orderRef: string; paymentRef: string | null; totalPaise: number; paymentId: string }): Promise<RefundResult>;
  /** Verifies a webhook signature and translates the payload. Throws on a bad signature. */
  parseWebhook(rawBody: string, headers: Headers): ProviderEvent;
}
