import { createTestDb, type DB } from "../src/server/db.ts";
import { createUser } from "../src/server/auth.ts";
import { approveCampaign, createCampaign, submitCampaign } from "../src/server/campaigns.ts";
import { cloneTemplate } from "../src/shared/templates.ts";
import { applyProviderEvent, createQuote, startCheckout } from "../src/server/payments/service.ts";
import { mockProvider } from "../src/server/payments/providers/mock.ts";
import type { ProviderEvent } from "../src/server/payments/providers/types.ts";

let seq = 0;

export function setup() {
  const db = createTestDb();
  const admin = createUser({ email: "admin@test", password: "pw-admin-1", displayName: "Admin", role: "admin" }, db);
  return { db, admin };
}

export function buyer(db: DB, admin: { id: string }, name = `Buyer ${++seq}`) {
  const user = createUser({ email: `b${++seq}@test`, password: "pw-buyer-1", displayName: name }, db);
  const cfg = cloneTemplate("floating-products");
  cfg.brand.name = name;
  const campaign = createCampaign(user.id, name, cfg, {}, db);
  submitCampaign(user.id, campaign.id, db);
  approveCampaign(admin.id, campaign.id, db);
  return { user, campaign };
}

export function evt(type: ProviderEvent["type"], orderRef: string, amountPaise?: number, eventId?: string): ProviderEvent {
  return { eventId: eventId ?? `evt_${++seq}`, type, orderRef, paymentRef: `pref_${orderRef}`, amountPaise, raw: {} };
}

/** Quote + checkout, returning the payment ready for a provider event. */
export async function checkout(db: DB, userId: string, campaignId: string, amountPaise: number) {
  const { quote } = createQuote(userId, campaignId, amountPaise, db);
  const res = await startCheckout(userId, quote.id, quote.total_paise, true, db, mockProvider);
  return { quote, payment: res.payment };
}

export async function capture(db: DB, payment: { provider_ref: string | null; total_paise: number }, eventId?: string) {
  return applyProviderEvent("mock", evt("payment.captured", payment.provider_ref!, payment.total_paise, eventId), db, mockProvider);
}
