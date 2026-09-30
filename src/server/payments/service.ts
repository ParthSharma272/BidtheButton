import { config } from "../config.ts";
import { audit, getDb, newId, txImmediate, type DB } from "../db.ts";
import { publish } from "../bus.ts";
import { getCampaign, purchasableReason } from "../campaigns.ts";
import { activateReign, getOwnershipState, StaleOwnershipError } from "../ownership.ts";
import { minimumNextPurchasePaise, priceBreakdown, type PriceBreakdown } from "../pricing.ts";
import { canTransition, describeState, type PaymentState } from "./machine.ts";
import { getProvider } from "./providers/index.ts";
import type { PaymentProvider, ProviderEvent } from "./providers/types.ts";

/**
 * Takeover purchasing.
 *
 *   quote  ─►  checkout (payment row + provider order)  ─►  provider webhook
 *                                                            │
 *                         ┌──────────────────────────────────┘
 *                         ▼
 *   one IMMEDIATE transaction: dedupe event ▸ transition payment ▸ activate reign
 *                         │                                   or ▸ mark refund_pending
 *                         ▼
 *   after commit: broadcast new owner  /  ask provider for the refund
 *
 * Nothing the browser says is ever treated as proof of payment. Ownership only
 * changes inside `applyProviderEvent`, driven by a signature-verified event.
 */

export const MAX_PURCHASE_PAISE = 10_000_000_00; // ₹1 crore sanity cap

export class PurchaseError extends Error {
  status: number;
  code: string;
  data?: Record<string, unknown>;
  constructor(code: string, message: string, status = 400, data?: Record<string, unknown>) {
    super(message);
    this.code = code;
    this.status = status;
    this.data = data;
  }
}

export interface QuoteRow {
  id: string;
  user_id: string;
  campaign_id: string;
  ownership_version: number;
  min_amount_paise: number;
  amount_paise: number;
  fee_paise: number;
  tax_paise: number;
  total_paise: number;
  currency: "INR";
  status: "open" | "consumed" | "stale" | "expired" | "cancelled";
  created_at: number;
  expires_at: number;
}

export interface PaymentRow {
  id: string;
  quote_id: string;
  user_id: string;
  campaign_id: string;
  provider: string;
  provider_ref: string | null;
  provider_payment_ref: string | null;
  amount_paise: number;
  total_paise: number;
  currency: string;
  state: PaymentState;
  failure_reason: string | null;
  refund_attempts: number;
  reign_id: string | null;
  is_demo: number;
  created_at: number;
  updated_at: number;
}

export function getQuote(id: string, db: DB = getDb()): QuoteRow | null {
  return (db.prepare("SELECT * FROM quotes WHERE id = ?").get(id) as QuoteRow | undefined) ?? null;
}

export function getPayment(id: string, db: DB = getDb()): PaymentRow | null {
  return (db.prepare("SELECT * FROM payments WHERE id = ?").get(id) as PaymentRow | undefined) ?? null;
}

// ------------------------------------------------------------------ quotes

export function createQuote(
  userId: string,
  campaignId: string,
  amountPaise: number,
  db: DB = getDb(),
): { quote: QuoteRow; breakdown: PriceBreakdown } {
  const campaign = getCampaign(campaignId, db);
  if (!campaign || campaign.user_id !== userId) throw new PurchaseError("campaign_not_found", "Campaign not found", 404);
  const notReady = purchasableReason(campaign);
  if (notReady) throw new PurchaseError("campaign_not_eligible", notReady, 409);

  const state = getOwnershipState(db);
  const minPaise = minimumNextPurchasePaise(state.last_amount_paise);
  if (!Number.isSafeInteger(amountPaise) || amountPaise % 100 !== 0) {
    throw new PurchaseError("invalid_amount", "Enter a whole-rupee amount", 422);
  }
  if (amountPaise < minPaise) {
    throw new PurchaseError("below_minimum", "Amount is below the current minimum takeover price", 409, { minPaise });
  }
  if (amountPaise > MAX_PURCHASE_PAISE) throw new PurchaseError("above_maximum", "Amount is above the maximum allowed purchase", 422);

  const breakdown = priceBreakdown(amountPaise);
  const now = Date.now();
  const id = newId("qte");
  db.transaction(() => {
    db.prepare("UPDATE quotes SET status = 'cancelled' WHERE user_id = ? AND status = 'open'").run(userId);
    db.prepare(
      `INSERT INTO quotes (id, user_id, campaign_id, ownership_version, min_amount_paise, amount_paise, fee_paise, tax_paise, total_paise, status, created_at, expires_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'open', ?, ?)`,
    ).run(id, userId, campaignId, state.version, minPaise, amountPaise, breakdown.feePaise, breakdown.taxPaise, breakdown.totalPaise, now, now + config.quoteTtlMs);
  })();
  return { quote: getQuote(id, db)!, breakdown };
}

/** Throws a PurchaseError describing why the quote can no longer be used. */
function assertQuoteUsable(quote: QuoteRow, db: DB): void {
  const state = getOwnershipState(db);
  if (quote.status === "consumed") throw new PurchaseError("quote_consumed", "This quote has already been paid", 409);
  if (quote.status !== "open" || quote.expires_at < Date.now() || state.version !== quote.ownership_version) {
    const reason = state.version !== quote.ownership_version ? "stale" : "expired";
    if (quote.status === "open") db.prepare("UPDATE quotes SET status = ? WHERE id = ?").run(reason, quote.id);
    throw new PurchaseError(
      reason === "stale" ? "quote_stale" : "quote_expired",
      reason === "stale"
        ? "Someone took over while you were reviewing. The price has changed — please review the new minimum."
        : "This quote expired. Please review the current price.",
      409,
      { minPaise: minimumNextPurchasePaise(state.last_amount_paise) },
    );
  }
}

// ------------------------------------------------------------------ checkout

export interface CheckoutResult {
  payment: PaymentRow;
  provider: PaymentProvider["name"];
  isTestMode: boolean;
  clientData: Record<string, unknown>;
}

/**
 * Starts payment for a quote. `consentedTotalPaise` is the exact total the
 * buyer saw and agreed to. If it differs from the quote we refuse, so the
 * amount charged can never drift from the amount consented to.
 */
export async function startCheckout(
  userId: string,
  quoteId: string,
  consentedTotalPaise: number,
  acceptedTerms: boolean,
  db: DB = getDb(),
  provider: PaymentProvider = getProvider(),
): Promise<CheckoutResult> {
  if (!acceptedTerms) throw new PurchaseError("terms_required", "Please confirm you understand the ownership rules", 422);
  const quote = getQuote(quoteId, db);
  if (!quote || quote.user_id !== userId) throw new PurchaseError("quote_not_found", "Quote not found", 404);
  if (quote.total_paise !== consentedTotalPaise) {
    throw new PurchaseError("total_mismatch", "The total changed. Please review the amount again.", 409);
  }

  // Reuse an in-flight payment for the same quote (double-clicked Pay button).
  const existing = db
    .prepare("SELECT * FROM payments WHERE quote_id = ? AND state IN ('created','processing') ORDER BY created_at DESC LIMIT 1")
    .get(quoteId) as PaymentRow | undefined;
  if (existing && existing.provider === provider.name) {
    return { payment: existing, provider: provider.name, isTestMode: provider.isTestMode, clientData: { demo: provider.name === "mock", totalPaise: existing.total_paise, orderRef: existing.provider_ref } };
  }

  assertQuoteUsable(quote, db);
  const campaign = getCampaign(quote.campaign_id, db);
  const notReady = campaign ? purchasableReason(campaign) : "Campaign not found";
  if (notReady) throw new PurchaseError("campaign_not_eligible", notReady, 409);

  const paymentId = newId("pay");
  const now = Date.now();
  db.prepare(
    `INSERT INTO payments (id, quote_id, user_id, campaign_id, provider, amount_paise, total_paise, currency, state, is_demo, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'INR', 'created', ?, ?, ?)`,
  ).run(paymentId, quote.id, userId, quote.campaign_id, provider.name, quote.amount_paise, quote.total_paise, provider.isTestMode ? 1 : 0, now, now);

  let order;
  try {
    order = await provider.createOrder({ paymentId, totalPaise: quote.total_paise, currency: "INR", description: "THE BUTTON — temporary page control" });
  } catch (e) {
    transition(db, paymentId, "voided", { failureReason: "provider_order_failed" });
    throw new PurchaseError("provider_error", "Could not start payment. You have not been charged.", 502);
  }
  db.prepare("UPDATE payments SET provider_ref = ?, updated_at = ? WHERE id = ?").run(order.orderRef, Date.now(), paymentId);
  audit("payment.created", "payment", paymentId, { quoteId, totalPaise: quote.total_paise, provider: provider.name }, userId, db);

  return { payment: getPayment(paymentId, db)!, provider: provider.name, isTestMode: provider.isTestMode, clientData: { ...order.clientData, orderRef: order.orderRef } };
}

/** Buyer closed the checkout without paying. Only allowed before capture. */
export function cancelCheckout(userId: string, paymentId: string, db: DB = getDb()): PaymentRow {
  const p = getPayment(paymentId, db);
  if (!p || p.user_id !== userId) throw new PurchaseError("payment_not_found", "Payment not found", 404);
  if (p.state === "created") transition(db, paymentId, "voided", { failureReason: "cancelled_by_buyer" });
  return getPayment(paymentId, db)!;
}

// ------------------------------------------------------------------ state transitions

function transition(
  db: DB,
  paymentId: string,
  to: PaymentState,
  extra: { failureReason?: string; reignId?: string; paymentRef?: string } = {},
): boolean {
  const p = getPayment(paymentId, db);
  if (!p || !canTransition(p.state, to)) return false;
  const now = Date.now();
  const res = db
    .prepare(
      `UPDATE payments SET state = ?, updated_at = ?,
         failure_reason = COALESCE(?, failure_reason),
         reign_id = COALESCE(?, reign_id),
         provider_payment_ref = COALESCE(?, provider_payment_ref),
         captured_at = CASE WHEN ? = 'captured' THEN ? ELSE captured_at END,
         settled_at  = CASE WHEN ? = 'settled'  THEN ? ELSE settled_at END,
         resolved_at = CASE WHEN ? IN ('refunded','failed','voided') THEN ? ELSE resolved_at END
       WHERE id = ? AND state = ?`,
    )
    .run(to, now, extra.failureReason ?? null, extra.reignId ?? null, extra.paymentRef ?? null, to, now, to, now, to, now, paymentId, p.state);
  if (res.changes === 1) {
    audit("payment.transition", "payment", paymentId, { from: p.state, to, ...extra }, p.user_id, db);
    return true;
  }
  return false;
}

/**
 * Attempts activation for a captured payment. Runs inside the caller's
 * IMMEDIATE transaction. Returns what happened; never throws for business
 * outcomes — an unactivatable capture always becomes refund_pending.
 */
function finalizeCaptured(tx: DB, paymentId: string): "activated" | "refund_pending" | "noop" {
  const p = getPayment(paymentId, tx);
  if (!p || p.state !== "captured") return "noop";
  const quote = getQuote(p.quote_id, tx)!;
  const campaign = getCampaign(p.campaign_id, tx);

  const refund = (reason: string) => {
    transition(tx, paymentId, "refund_pending", { failureReason: reason });
    if (quote.status === "open") tx.prepare("UPDATE quotes SET status = 'stale' WHERE id = ?").run(quote.id);
    return "refund_pending" as const;
  };

  if (!campaign || purchasableReason(campaign)) return refund("campaign_not_eligible");

  try {
    // A savepoint so a failure inside activation rolls back only its own writes.
    const reign = tx.transaction(() =>
      activateReign(tx, {
        expectedVersion: quote.ownership_version,
        userId: p.user_id,
        campaignId: p.campaign_id,
        configJson: campaign.config_json!,
        amountPaise: p.amount_paise,
        paymentId: p.id,
        isDemo: !!p.is_demo,
      }),
    )();
    transition(tx, paymentId, "settled", { reignId: reign.id });
    tx.prepare("UPDATE quotes SET status = 'consumed' WHERE id = ?").run(quote.id);
    return "activated";
  } catch (e) {
    if (e instanceof StaleOwnershipError) return refund("outbid_before_activation");
    return refund("activation_error");
  }
}

export interface EventOutcome {
  duplicate: boolean;
  outcome: string;
  paymentId?: string;
}

/**
 * The single entry point for provider events. Idempotent: the UNIQUE index on
 * (provider, provider_event_id) means a redelivered event is recorded once and
 * then ignored. State changes use compare-and-set, so out-of-order or delayed
 * events cannot move a payment backwards or displace a newer owner.
 */
export async function applyProviderEvent(
  providerName: PaymentProvider["name"],
  ev: ProviderEvent,
  db: DB = getDb(),
  provider: PaymentProvider = getProvider(providerName),
): Promise<EventOutcome> {
  const result = txImmediate((tx): EventOutcome => {
    const dup = tx.prepare("SELECT outcome FROM payment_events WHERE provider = ? AND provider_event_id = ?").get(providerName, ev.eventId) as
      | { outcome: string }
      | undefined;
    if (dup) return { duplicate: true, outcome: dup.outcome };

    const p = tx.prepare("SELECT * FROM payments WHERE provider = ? AND provider_ref = ?").get(providerName, ev.orderRef) as PaymentRow | undefined;
    let outcome = "ignored";

    if (!p) {
      outcome = "unknown_order";
    } else {
      switch (ev.type) {
        case "payment.processing":
          outcome = transition(tx, p.id, "processing", { paymentRef: ev.paymentRef }) ? "processing" : `ignored_in_${p.state}`;
          break;
        case "payment.captured": {
          if (!transition(tx, p.id, "captured", { paymentRef: ev.paymentRef })) {
            // Already captured/settled/refunded, or a capture arriving after the
            // buyer abandoned (voided). The latter still took money: refund it.
            if (p.state === "voided" || p.state === "failed") {
              outcome = "late_capture_after_" + p.state;
              tx.prepare("UPDATE payments SET state = 'refund_pending', failure_reason = 'late_capture', provider_payment_ref = COALESCE(?, provider_payment_ref), updated_at = ? WHERE id = ?").run(
                ev.paymentRef ?? null,
                Date.now(),
                p.id,
              );
              audit("payment.late_capture", "payment", p.id, { from: p.state }, null, tx);
            } else outcome = `ignored_in_${p.state}`;
            break;
          }
          if (ev.amountPaise !== undefined && ev.amountPaise !== p.total_paise) {
            transition(tx, p.id, "refund_pending", { failureReason: "amount_mismatch" });
            outcome = "amount_mismatch";
            break;
          }
          outcome = finalizeCaptured(tx, p.id);
          break;
        }
        case "payment.failed":
          outcome = transition(tx, p.id, "failed", { failureReason: ev.reason ?? "declined" }) ? "failed" : `ignored_in_${p.state}`;
          break;
        case "refund.processed":
          outcome = transition(tx, p.id, "refunded") ? "refunded" : `ignored_in_${p.state}`;
          break;
        case "refund.failed":
          // Stay in refund_pending; the recovery job retries and alerts.
          outcome = "refund_failed";
          audit("payment.refund_failed", "payment", p.id, { reason: ev.reason }, null, tx);
          break;
      }
    }

    tx.prepare(
      `INSERT INTO payment_events (id, payment_id, provider, provider_event_id, type, payload_json, outcome, received_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(newId("pev"), p?.id ?? null, providerName, ev.eventId, ev.type, JSON.stringify(ev.raw ?? null), outcome, Date.now());

    return { duplicate: false, outcome, paymentId: p?.id };
  }, db);

  if (!result.duplicate && result.outcome === "activated") {
    publish({ type: "ownership", payload: { reason: "takeover" } });
  }
  if (result.paymentId) {
    const p = getPayment(result.paymentId, db);
    if (p?.state === "refund_pending") await issueRefund(p.id, db, provider);
  }
  return result;
}

/** Asks the provider to refund. Safe to call repeatedly (recovery job does). */
export async function issueRefund(paymentId: string, db: DB = getDb(), provider?: PaymentProvider): Promise<PaymentRow> {
  const p = getPayment(paymentId, db);
  if (!p || p.state !== "refund_pending") return p!;
  const prov = provider ?? getProvider(p.provider);
  db.prepare("UPDATE payments SET refund_attempts = refund_attempts + 1, updated_at = ? WHERE id = ?").run(Date.now(), paymentId);
  try {
    const r = await prov.refund({ orderRef: p.provider_ref ?? "", paymentRef: p.provider_payment_ref, totalPaise: p.total_paise, paymentId });
    audit("payment.refund_requested", "payment", paymentId, r, null, db);
    if (r.status === "processed") transition(db, paymentId, "refunded");
  } catch (e) {
    audit("payment.refund_error", "payment", paymentId, { error: String(e) }, null, db);
  }
  return getPayment(paymentId, db)!;
}

/** Administrator refund of a settled payment. History and reign are kept. */
export async function adminRefund(adminId: string, paymentId: string, db: DB = getDb()): Promise<PaymentRow> {
  const ok = transition(db, paymentId, "refund_pending", { failureReason: "admin_refund" });
  if (!ok) throw new PurchaseError("invalid_state", "Only settled payments can be refunded by an administrator", 409);
  audit("payment.admin_refund", "payment", paymentId, null, adminId, db);
  return issueRefund(paymentId, db);
}

export function paymentStatusForBuyer(userId: string, paymentId: string, db: DB = getDb()) {
  const p = getPayment(paymentId, db);
  if (!p || p.user_id !== userId) throw new PurchaseError("payment_not_found", "Payment not found", 404);
  const state = getOwnershipState(db);
  return {
    id: p.id,
    state: p.state,
    message: describeState(p.state, p.failure_reason),
    failureReason: p.failure_reason,
    totalPaise: p.total_paise,
    amountPaise: p.amount_paise,
    reignId: p.reign_id,
    isDemo: !!p.is_demo,
    currentMinPaise: minimumNextPurchasePaise(state.last_amount_paise),
  };
}

// ------------------------------------------------------------------ recovery

/**
 * Background recovery. Idempotent; safe to run concurrently with webhooks.
 *  - captured payments that never finalized (crash between steps) → finalize
 *  - refund_pending → retry the refund
 *  - created/processing older than the abandonment window → void
 *  - open quotes past expiry → expired
 */
export async function runPaymentRecovery(db: DB = getDb(), opts: { abandonAfterMs?: number } = {}): Promise<Record<string, number>> {
  const now = Date.now();
  const stats = { finalized: 0, refunds: 0, voided: 0, quotesExpired: 0 };

  stats.quotesExpired = db.prepare("UPDATE quotes SET status = 'expired' WHERE status = 'open' AND expires_at < ?").run(now).changes;

  const stuck = db.prepare("SELECT id FROM payments WHERE state = 'captured'").all() as { id: string }[];
  for (const { id } of stuck) {
    const outcome = txImmediate((tx) => finalizeCaptured(tx, id), db);
    if (outcome === "activated") publish({ type: "ownership", payload: { reason: "takeover" } });
    stats.finalized++;
  }

  const pending = db.prepare("SELECT id FROM payments WHERE state = 'refund_pending' AND refund_attempts < 20").all() as { id: string }[];
  for (const { id } of pending) {
    await issueRefund(id, db);
    stats.refunds++;
  }

  // Only void orders the provider has had ample time to report on. For a real
  // provider, a production deployment should query the order status first.
  const abandonAfter = opts.abandonAfterMs ?? 30 * 60 * 1000;
  const old = db.prepare("SELECT id FROM payments WHERE state IN ('created','processing') AND updated_at < ?").all(now - abandonAfter) as { id: string }[];
  for (const { id } of old) {
    if (transition(db, id, "voided", { failureReason: "abandoned" })) stats.voided++;
  }
  return stats;
}
