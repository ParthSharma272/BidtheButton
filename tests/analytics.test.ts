import { describe, expect, it } from "vitest";
import { buyer, capture, checkout, setup } from "./helpers.ts";
import { heartbeat, recordEvent, reignCounters, watchingNow, reignAnalytics } from "../src/server/analytics.ts";
import { currentReign } from "../src/server/ownership.ts";

const UA = "Mozilla/5.0 (Macintosh) AppleWebKit Chrome/130 Safari";

describe("analytics", () => {
  it("dedupes rapid presses and repeated views, filters bots, and attributes to the reign actually seen", async () => {
    const { db, admin } = setup();
    const a = buyer(db, admin);
    const b = buyer(db, admin);
    await capture(db, (await checkout(db, a.user.id, a.campaign.id, 1000)).payment);
    const reignA = currentReign(db)!;
    const t = Date.now();

    expect(recordEvent({ type: "button_press", reignId: reignA.id, clientId: "client_aaaa", userAgent: UA, now: t }, db).recorded).toBe(true);
    expect(recordEvent({ type: "button_press", reignId: reignA.id, clientId: "client_aaaa", userAgent: UA, now: t + 300 }, db).recorded).toBe(false);
    expect(recordEvent({ type: "button_press", reignId: reignA.id, clientId: "client_aaaa", userAgent: UA, now: t + 5000 }, db).recorded).toBe(true);
    expect(recordEvent({ type: "campaign_view", reignId: reignA.id, clientId: "client_aaaa", userAgent: UA, now: t }, db).recorded).toBe(true);
    expect(recordEvent({ type: "campaign_view", reignId: reignA.id, clientId: "client_aaaa", userAgent: UA, now: t + 60_000 }, db).recorded).toBe(false);
    expect(recordEvent({ type: "campaign_view", reignId: reignA.id, clientId: "client_bbbb", userAgent: "Googlebot/2.1", now: t }, db).reason).toBe("bot");

    // Takeover happens while client_aaaa is still watching A's video.
    await capture(db, (await checkout(db, b.user.id, b.campaign.id, 1100)).payment);
    expect(recordEvent({ type: "outbound_click", reignId: reignA.id, clientId: "client_aaaa", userAgent: UA }, db).recorded).toBe(true);

    expect(reignCounters(reignA.id, db)).toEqual({ views: 1, presses: 2, experienceViews: 0, outboundClicks: 1 });
    expect(reignCounters(currentReign(db)!.id, db).outboundClicks).toBe(0);
  });

  it("watching now counts distinct visible clients with a fresh heartbeat", () => {
    const { db } = setup();
    const now = Date.now();
    heartbeat("client_one1", true, null, db, now);
    heartbeat("client_one1", true, null, db, now); // second tab, same client id
    heartbeat("client_two2", false, null, db, now); // hidden tab
    heartbeat("client_old3", true, null, db, now - 10 * 60_000); // expired
    expect(watchingNow(db, now)).toBe(1);
  });

  it("reports unmeasurable metrics as null rather than zero", async () => {
    const { db, admin } = setup();
    const a = buyer(db, admin);
    await capture(db, (await checkout(db, a.user.id, a.campaign.id, 1000)).payment);
    const r = reignAnalytics(currentReign(db)!.id, db)!;
    expect(r.cpmPaise).toBeNull();
    expect(r.cpcPaise).toBeNull();
    expect(r.ctr.rate).toBeNull();
    expect(r.avgEngagedMs).toBeNull();
    expect(r.peakConcurrent).toBeNull();
  });
});
