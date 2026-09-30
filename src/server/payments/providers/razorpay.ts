import { createHmac, timingSafeEqual } from "node:crypto";
import type { PaymentProvider, ProviderEvent } from "./types.ts";

/**
 * Razorpay adapter.
 *
 * NOT VERIFIED AGAINST A LIVE ACCOUNT. It is written against Razorpay's
 * documented Orders, Refunds and Webhooks APIs and needs
 * RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET and RAZORPAY_WEBHOOK_SECRET, plus the
 * Checkout.js script allowed by the CSP. Test it in Razorpay test mode before
 * enabling it. The webhook must subscribe to: payment.captured, payment.failed,
 * refund.processed, refund.failed. Orders must be created with auto-capture.
 */

const API = "https://api.razorpay.com/v1";

function creds() {
  const id = process.env.RAZORPAY_KEY_ID;
  const secret = process.env.RAZORPAY_KEY_SECRET;
  if (!id || !secret) throw new Error("RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET are not configured");
  return { id, secret, auth: "Basic " + Buffer.from(`${id}:${secret}`).toString("base64") };
}

async function call<T>(path: string, body: unknown): Promise<T> {
  const { auth } = creds();
  const res = await fetch(`${API}${path}`, {
    method: "POST",
    headers: { Authorization: auth, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Razorpay ${path} failed: ${res.status} ${await res.text()}`);
  return (await res.json()) as T;
}

export const razorpayProvider: PaymentProvider = {
  name: "razorpay",
  isTestMode: (process.env.RAZORPAY_KEY_ID ?? "").startsWith("rzp_test_"),

  async createOrder({ paymentId, totalPaise, currency, description }) {
    const order = await call<{ id: string }>("/orders", {
      amount: totalPaise,
      currency,
      receipt: paymentId,
      notes: { payment_id: paymentId, description },
      payment_capture: 1,
    });
    return { orderRef: order.id, clientData: { keyId: creds().id, orderId: order.id, amount: totalPaise, currency } };
  },

  async refund({ paymentRef, totalPaise, paymentId }) {
    if (!paymentRef) throw new Error("Cannot refund without the provider payment id");
    const r = await call<{ id: string; status: string }>(`/payments/${paymentRef}/refund`, {
      amount: totalPaise,
      speed: "normal",
      notes: { payment_id: paymentId },
      receipt: `refund_${paymentId}`,
    });
    return { status: r.status === "processed" ? "processed" : "pending", refundRef: r.id };
  },

  parseWebhook(rawBody, headers): ProviderEvent {
    const secret = process.env.RAZORPAY_WEBHOOK_SECRET;
    if (!secret) throw new Error("RAZORPAY_WEBHOOK_SECRET is not configured");
    const sig = headers.get("x-razorpay-signature") ?? "";
    const expected = createHmac("sha256", secret).update(rawBody).digest("hex");
    const a = Buffer.from(sig);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !timingSafeEqual(a, b)) throw new Error("Invalid webhook signature");

    const j = JSON.parse(rawBody);
    const eventId = headers.get("x-razorpay-event-id") ?? `${j.event}:${j.payload?.payment?.entity?.id ?? j.payload?.refund?.entity?.id}`;
    const payment = j.payload?.payment?.entity;
    const refund = j.payload?.refund?.entity;
    const map: Record<string, ProviderEvent["type"]> = {
      "payment.authorized": "payment.processing",
      "payment.captured": "payment.captured",
      "payment.failed": "payment.failed",
      "refund.processed": "refund.processed",
      "refund.failed": "refund.failed",
    };
    const type = map[j.event];
    if (!type) throw new Error(`Unhandled Razorpay event ${j.event}`);
    return {
      eventId,
      type,
      orderRef: payment?.order_id ?? refund?.notes?.order_id ?? "",
      paymentRef: payment?.id ?? refund?.payment_id,
      amountPaise: payment?.amount,
      reason: payment?.error_description,
      raw: j,
    };
  },
};
