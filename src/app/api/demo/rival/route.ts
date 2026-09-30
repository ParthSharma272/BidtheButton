import { isDemoProvider } from "@/server/config.ts";
import { getDb } from "@/server/db.ts";
import { handle, HttpError, json, limit } from "@/server/http.ts";
import { currentReign, currentMinimumPaise } from "@/server/ownership.ts";
import { createQuote, startCheckout } from "@/server/payments/service.ts";
import { buildMockEvent } from "@/server/payments/providers/mock.ts";

/**
 * DEMO MODE ONLY. A seeded demo account buys the button through the normal
 * quote → checkout → signed webhook path with the mock provider, so you can
 * watch a live takeover arrive in every open tab. No money moves.
 */
export const POST = handle(async (req: Request) => {
  if (!isDemoProvider()) throw new HttpError("Not available", 404);
  await limit("demo-rival", 6, 60_000);
  const db = getDb();
  const current = currentReign(db);
  const candidates = db
    .prepare(
      `SELECT c.id, c.user_id FROM campaigns c JOIN users u ON u.id = c.user_id
       WHERE u.is_demo = 1 AND c.is_demo = 1 AND c.config_json IS NOT NULL AND c.status != 'suspended' AND c.user_id != ?`,
    )
    .all(current?.user_id ?? "") as { id: string; user_id: string }[];
  if (!candidates.length) throw new HttpError("No demo rivals available. Run npm run seed.", 409);
  const pick = candidates[Math.floor(Math.random() * candidates.length)];

  const min = currentMinimumPaise(db);
  // Rivals sometimes overpay a little, like people do. Always whole rupees.
  const amount = Math.ceil((min * (1 + Math.random() * 0.25)) / 100) * 100;
  const { quote } = createQuote(pick.user_id, pick.id, amount, db);
  const co = await startCheckout(pick.user_id, quote.id, quote.total_paise, true, db);

  const ev = buildMockEvent({ type: "payment.captured", orderRef: co.payment.provider_ref!, amountPaise: co.payment.total_paise });
  const origin = new URL(req.url).origin;
  const res = await fetch(`${origin}/api/webhooks/mock`, { method: "POST", headers: { "Content-Type": "application/json", "x-mock-signature": ev.signature }, body: ev.body });
  return json({ ok: res.ok, result: await res.json().catch(() => null) });
});
