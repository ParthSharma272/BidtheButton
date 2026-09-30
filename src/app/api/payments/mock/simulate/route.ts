import { isDemoProvider } from "@/server/config.ts";
import { handle, HttpError, json, readJson, requireUser } from "@/server/http.ts";
import { buildMockEvent } from "@/server/payments/providers/mock.ts";
import { getPayment } from "@/server/payments/service.ts";

/**
 * DEMO ONLY. Plays the role of the payment gateway: it produces a signed
 * webhook and delivers it to our own webhook endpoint over HTTP, exactly as a
 * real provider would. It does not touch payment state itself.
 *
 * outcome "success_duplicate" delivers the capture twice to demonstrate
 * idempotency; "success_delayed" waits a few seconds first.
 */
export const POST = handle(async (req: Request) => {
  if (!isDemoProvider()) throw new HttpError("Not available", 404);
  const user = await requireUser();
  const b = await readJson<{ paymentId?: string; outcome?: string }>(req);
  const p = getPayment(String(b.paymentId ?? ""));
  if (!p || p.user_id !== user.id || !p.provider_ref) throw new HttpError("Payment not found", 404);

  const origin = new URL(req.url).origin;
  const deliver = async (ev: { body: string; signature: string }) =>
    fetch(`${origin}/api/webhooks/mock`, { method: "POST", headers: { "Content-Type": "application/json", "x-mock-signature": ev.signature }, body: ev.body });

  const outcome = String(b.outcome ?? "success");
  await deliver(buildMockEvent({ type: "payment.processing", orderRef: p.provider_ref }));

  const run = async () => {
    if (outcome === "decline") {
      await deliver(buildMockEvent({ type: "payment.failed", orderRef: p.provider_ref!, reason: "Card declined (test)" }));
      return;
    }
    const cap = buildMockEvent({ type: "payment.captured", orderRef: p.provider_ref!, amountPaise: p.total_paise });
    await deliver(cap);
    if (outcome === "success_duplicate") await deliver(cap);
  };

  if (outcome === "success_delayed") setTimeout(() => void run(), 4000);
  else await run();
  return json({ ok: true });
});
