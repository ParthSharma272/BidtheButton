import { describe, expect, it } from "vitest";
import { buyer, capture, checkout, evt, setup } from "./helpers.ts";
import { getOwnershipState, currentReign } from "../src/server/ownership.ts";
import { applyProviderEvent, getPayment, runPaymentRecovery, startCheckout, createQuote, PurchaseError } from "../src/server/payments/service.ts";
import { mockProvider } from "../src/server/payments/providers/mock.ts";

describe("ownership transfer", () => {
  it("a verified capture transfers ownership exactly once", async () => {
    const { db, admin } = setup();
    const a = buyer(db, admin);
    const { payment } = await checkout(db, a.user.id, a.campaign.id, 1000);

    expect(getOwnershipState(db).version).toBe(0);
    const r = await capture(db, payment);
    expect(r.outcome).toBe("activated");

    const s = getOwnershipState(db);
    expect(s.version).toBe(1);
    expect(s.last_amount_paise).toBe(1000);
    expect(currentReign(db)!.user_id).toBe(a.user.id);
    expect(getPayment(payment.id, db)!.state).toBe("settled");
  });

  it("starting checkout does not transfer ownership", async () => {
    const { db, admin } = setup();
    const a = buyer(db, admin);
    await checkout(db, a.user.id, a.campaign.id, 1000);
    expect(getOwnershipState(db).version).toBe(0);
    expect(currentReign(db)).toBeNull();
  });

  it("race: two buyers quoted at the same version — first capture wins, second is refunded", async () => {
    const { db, admin } = setup();
    const a = buyer(db, admin);
    const b = buyer(db, admin);
    const pa = await checkout(db, a.user.id, a.campaign.id, 1000);
    const pb = await checkout(db, b.user.id, b.campaign.id, 5000);

    const [ra, rb] = await Promise.all([capture(db, pa.payment), capture(db, pb.payment)]);
    expect(ra.outcome).toBe("activated");
    expect(rb.outcome).toBe("refund_pending");

    const loser = getPayment(pb.payment.id, db)!;
    expect(loser.state).toBe("refunded"); // mock provider refunds synchronously
    expect(loser.failure_reason).toBe("outbid_before_activation");

    const open = db.prepare("SELECT COUNT(*) AS n FROM reigns WHERE ended_at IS NULL").get() as { n: number };
    expect(open.n).toBe(1);
    expect(currentReign(db)!.user_id).toBe(a.user.id);
    // The loser's higher amount never became the price basis.
    expect(getOwnershipState(db).last_amount_paise).toBe(1000);
  });

  it("the database refuses a second open reign even if application code were wrong", () => {
    const { db, admin } = setup();
    const a = buyer(db, admin);
    const ins = db.prepare(
      "INSERT INTO reigns (id, ordinal, user_id, campaign_id, config_snapshot_json, amount_paise, started_at) VALUES (?, ?, ?, ?, '{}', 1000, 0)",
    );
    ins.run("r1", 1, a.user.id, a.campaign.id);
    expect(() => ins.run("r2", 2, a.user.id, a.campaign.id)).toThrow(/UNIQUE/);
  });

  it("a delayed webhook for an old quote cannot overwrite a newer owner", async () => {
    const { db, admin } = setup();
    const a = buyer(db, admin);
    const b = buyer(db, admin);
    const c = buyer(db, admin);

    const slow = await checkout(db, a.user.id, a.campaign.id, 1000); // quoted at v0
    const fast = await checkout(db, b.user.id, b.campaign.id, 1000); // quoted at v0
    await capture(db, fast.payment); // b owns, v1
    const next = await checkout(db, c.user.id, c.campaign.id, 1100); // quoted at v1
    await capture(db, next.payment); // c owns, v2

    const late = await capture(db, slow.payment); // a's webhook finally arrives
    expect(late.outcome).toBe("refund_pending");
    expect(currentReign(db)!.user_id).toBe(c.user.id);
    expect(getOwnershipState(db).version).toBe(2);
    expect(getPayment(slow.payment.id, db)!.state).toBe("refunded");
  });
});

describe("stale quotes", () => {
  it("checkout on a stale quote is refused with the updated price and requires fresh consent", async () => {
    const { db, admin } = setup();
    const a = buyer(db, admin);
    const b = buyer(db, admin);
    const { quote } = createQuote(b.user.id, b.campaign.id, 1000, db); // quoted at v0
    const pa = await checkout(db, a.user.id, a.campaign.id, 2000);
    await capture(db, pa.payment); // v1, min now ₹22

    await expect(startCheckout(b.user.id, quote.id, quote.total_paise, true, db, mockProvider)).rejects.toMatchObject({
      code: "quote_stale",
      data: { minPaise: 2200 },
    });
    // No payment row was created for the stale quote.
    const n = db.prepare("SELECT COUNT(*) AS n FROM payments WHERE quote_id = ?").get(quote.id) as { n: number };
    expect(n.n).toBe(0);
  });

  it("never charges a different total than the buyer consented to", async () => {
    const { db, admin } = setup();
    const a = buyer(db, admin);
    const { quote } = createQuote(a.user.id, a.campaign.id, 1000, db);
    await expect(startCheckout(a.user.id, quote.id, quote.total_paise + 100, true, db, mockProvider)).rejects.toBeInstanceOf(PurchaseError);
  });

  it("rejects amounts below the minimum", () => {
    const { db, admin } = setup();
    const a = buyer(db, admin);
    expect(() => createQuote(a.user.id, a.campaign.id, 900, db)).toThrow(/minimum/);
  });

  it("requires explicit acceptance of the ownership rules", async () => {
    const { db, admin } = setup();
    const a = buyer(db, admin);
    const { quote } = createQuote(a.user.id, a.campaign.id, 1000, db);
    await expect(startCheckout(a.user.id, quote.id, quote.total_paise, false, db, mockProvider)).rejects.toMatchObject({ code: "terms_required" });
  });
});

describe("webhooks", () => {
  it("duplicate delivery of the same event is processed once", async () => {
    const { db, admin } = setup();
    const a = buyer(db, admin);
    const { payment } = await checkout(db, a.user.id, a.campaign.id, 1000);
    const first = await capture(db, payment, "evt_same");
    const second = await capture(db, payment, "evt_same");
    expect(first.duplicate).toBe(false);
    expect(second.duplicate).toBe(true);
    expect(getOwnershipState(db).takeover_count).toBe(1);
    const n = db.prepare("SELECT COUNT(*) AS n FROM payment_events").get() as { n: number };
    expect(n.n).toBe(1);
  });

  it("a second capture with a different event id is ignored, not re-activated", async () => {
    const { db, admin } = setup();
    const a = buyer(db, admin);
    const { payment } = await checkout(db, a.user.id, a.campaign.id, 1000);
    await capture(db, payment);
    const again = await capture(db, payment);
    expect(again.outcome).toBe("ignored_in_settled");
    expect(getOwnershipState(db).takeover_count).toBe(1);
  });

  it("a failed payment changes nothing and leaves the buyer uncharged", async () => {
    const { db, admin } = setup();
    const a = buyer(db, admin);
    const { payment } = await checkout(db, a.user.id, a.campaign.id, 1000);
    const r = await applyProviderEvent("mock", evt("payment.failed", payment.provider_ref!), db, mockProvider);
    expect(r.outcome).toBe("failed");
    expect(getPayment(payment.id, db)!.state).toBe("failed");
    expect(currentReign(db)).toBeNull();
    // A capture arriving after failure is out of order; it must not activate.
    const late = await capture(db, payment);
    expect(late.outcome).toBe("late_capture_after_failed");
    expect(getPayment(payment.id, db)!.state).toBe("refunded");
    expect(currentReign(db)).toBeNull();
  });

  it("an amount mismatch is refunded rather than activated", async () => {
    const { db, admin } = setup();
    const a = buyer(db, admin);
    const { payment } = await checkout(db, a.user.id, a.campaign.id, 1000);
    const r = await applyProviderEvent("mock", evt("payment.captured", payment.provider_ref!, 1), db, mockProvider);
    expect(r.outcome).toBe("amount_mismatch");
    expect(getPayment(payment.id, db)!.state).toBe("refunded");
    expect(currentReign(db)).toBeNull();
  });

  it("a campaign suspended between checkout and capture is refunded", async () => {
    const { db, admin } = setup();
    const a = buyer(db, admin);
    const { payment } = await checkout(db, a.user.id, a.campaign.id, 1000);
    const { suspendCampaign } = await import("../src/server/campaigns.ts");
    suspendCampaign(admin.id, a.campaign.id, "test", db);
    const r = await capture(db, payment);
    expect(r.outcome).toBe("refund_pending");
    expect(getPayment(payment.id, db)!.failure_reason).toBe("campaign_not_eligible");
  });
});

describe("refunds and recovery", () => {
  it("a refund the provider rejects stays pending and is retried by recovery", async () => {
    const { db, admin } = setup();
    const a = buyer(db, admin);
    const b = buyer(db, admin);
    const pa = await checkout(db, a.user.id, a.campaign.id, 1000);
    const pb = await checkout(db, b.user.id, b.campaign.id, 1000);
    await capture(db, pa.payment);

    let calls = 0;
    const flaky = { ...mockProvider, refund: async () => { calls++; throw new Error("gateway down"); } };
    await applyProviderEvent("mock", evt("payment.captured", pb.payment.provider_ref!, pb.payment.total_paise), db, flaky);
    expect(calls).toBe(1);
    expect(getPayment(pb.payment.id, db)!.state).toBe("refund_pending");

    // Gateway recovers; the background job completes the refund.
    const stats = await runPaymentRecovery(db);
    expect(stats.refunds).toBe(1);
    expect(getPayment(pb.payment.id, db)!.state).toBe("refunded");
  });

  it("an asynchronous refund completes on the refund.processed webhook", async () => {
    const { db, admin } = setup();
    const a = buyer(db, admin);
    const b = buyer(db, admin);
    const pa = await checkout(db, a.user.id, a.campaign.id, 1000);
    const pb = await checkout(db, b.user.id, b.campaign.id, 1000);
    await capture(db, pa.payment);
    const async = { ...mockProvider, refund: async () => ({ status: "pending" as const }) };
    await applyProviderEvent("mock", evt("payment.captured", pb.payment.provider_ref!, pb.payment.total_paise), db, async);
    expect(getPayment(pb.payment.id, db)!.state).toBe("refund_pending");
    await applyProviderEvent("mock", evt("refund.processed", pb.payment.provider_ref!), db, async);
    expect(getPayment(pb.payment.id, db)!.state).toBe("refunded");
  });

  it("abandoned checkouts are voided without affecting ownership", async () => {
    const { db, admin } = setup();
    const a = buyer(db, admin);
    const { payment } = await checkout(db, a.user.id, a.campaign.id, 1000);
    const stats = await runPaymentRecovery(db, { abandonAfterMs: -1 });
    expect(stats.voided).toBe(1);
    expect(getPayment(payment.id, db)!.state).toBe("voided");
  });
});
