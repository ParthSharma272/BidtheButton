import { describe, expect, it } from "vitest";
import { buyer, capture, checkout, setup } from "./helpers.ts";
import { approveCampaign, saveDraft, submitCampaign, createCampaign, CampaignError, suspendCampaign, reinstateCampaign } from "../src/server/campaigns.ts";
import { currentReign, getReign } from "../src/server/ownership.ts";
import { campaignConfigSchema, checkExternalUrl } from "../src/server/campaign-schema.ts";
import { cloneTemplate } from "../src/shared/templates.ts";
import { createQuote } from "../src/server/payments/service.ts";
import { getPublicState } from "../src/server/public-state.ts";
import { createUser } from "../src/server/auth.ts";

describe("publishing permissions", () => {
  it("unapproved campaigns cannot be bought", () => {
    const { db } = setup();
    const u = createUser({ email: "x@test", password: "pw-xxxxx", displayName: "X" }, db);
    const c = createCampaign(u.id, "X", cloneTemplate("bold-poster"), {}, db);
    expect(() => createQuote(u.id, c.id, 1000, db)).toThrow(/not been approved/);
  });

  it("a current owner's material edit keeps the last approved version live until approved", async () => {
    const { db, admin } = setup();
    const a = buyer(db, admin);
    await capture(db, (await checkout(db, a.user.id, a.campaign.id, 1000)).payment);

    const cfg = cloneTemplate("floating-products");
    cfg.brand.name = a.campaign.name;
    cfg.headline = "A brand new headline";
    saveDraft(a.user.id, a.campaign.id, undefined, cfg, db);
    const r = submitCampaign(a.user.id, a.campaign.id, db);
    expect(r.outcome).toBe("queued");
    expect(JSON.parse(currentReign(db)!.config_snapshot_json).headline).not.toBe("A brand new headline");

    approveCampaign(admin.id, a.campaign.id, db);
    expect(JSON.parse(currentReign(db)!.config_snapshot_json).headline).toBe("A brand new headline");
  });

  it("cosmetic edits by the current owner publish immediately", async () => {
    const { db, admin } = setup();
    const a = buyer(db, admin);
    await capture(db, (await checkout(db, a.user.id, a.campaign.id, 1000)).payment);
    const cfg = JSON.parse(a.campaign.draft_json);
    cfg.theme.palette.accent = "#ff0000";
    saveDraft(a.user.id, a.campaign.id, undefined, cfg, db);
    expect(submitCampaign(a.user.id, a.campaign.id, db).outcome).toBe("published_minor");
    expect(JSON.parse(currentReign(db)!.config_snapshot_json).theme.palette.accent).toBe("#ff0000");
  });

  it("an outbid owner cannot change the active page", async () => {
    const { db, admin } = setup();
    const a = buyer(db, admin);
    const b = buyer(db, admin);
    await capture(db, (await checkout(db, a.user.id, a.campaign.id, 1000)).payment);
    const aReign = currentReign(db)!;
    await capture(db, (await checkout(db, b.user.id, b.campaign.id, 1100)).payment);
    const bSnapshot = currentReign(db)!.config_snapshot_json;

    const cfg = JSON.parse(a.campaign.draft_json);
    cfg.theme.palette.accent = "#00ff00";
    saveDraft(a.user.id, a.campaign.id, undefined, cfg, db);
    submitCampaign(a.user.id, a.campaign.id, db);

    expect(currentReign(db)!.config_snapshot_json).toBe(bSnapshot);
    // A's historical record is untouched too: history shows what was actually live.
    expect(getReign(aReign.id, db)!.config_snapshot_json).toBe(aReign.config_snapshot_json);
  });

  it("users cannot edit someone else's campaign", () => {
    const { db, admin } = setup();
    const a = buyer(db, admin);
    const b = buyer(db, admin);
    expect(() => saveDraft(b.user.id, a.campaign.id, undefined, cloneTemplate("bold-poster"), db)).toThrow(CampaignError);
  });

  it("suspension shows a neutral screen but keeps ownership and payment records", async () => {
    const { db, admin } = setup();
    const a = buyer(db, admin);
    const { payment } = await checkout(db, a.user.id, a.campaign.id, 1000);
    await capture(db, payment);
    suspendCampaign(admin.id, a.campaign.id, "phishing", db);
    const s = getPublicState(db);
    expect(s.reign!.suspended).toBe(true);
    expect(s.reign!.config).toBeNull();
    expect(s.reign!.owner.id).toBe(a.user.id);
    expect(s.lastAmountPaise).toBe(1000);
    reinstateCampaign(admin.id, a.campaign.id, db);
    expect(getPublicState(db).reign!.config).not.toBeNull();
  });
});

describe("campaign content safety", () => {
  it("rejects unsafe destinations", () => {
    expect(checkExternalUrl("javascript:alert(1)").ok).toBe(false);
    expect(checkExternalUrl("http://example.com").ok).toBe(false);
    expect(checkExternalUrl("https://user:pw@example.com").ok).toBe(false);
    expect(checkExternalUrl("https://127.0.0.1/admin").ok).toBe(false);
    expect(checkExternalUrl("https://192.168.1.4").ok).toBe(false);
    expect(checkExternalUrl("https://example.com/path").ok).toBe(true);
  });

  it("has no field that accepts markup or style strings, and strips bidi spoofing", () => {
    const cfg = cloneTemplate("bold-poster") as any;
    cfg.headline = "Hello‮evil";
    cfg.theme.palette.primary = "red; background:url(x)";
    const r = campaignConfigSchema.safeParse(cfg);
    expect(r.success).toBe(false);
    cfg.theme.palette.primary = "#ff0000";
    const ok = campaignConfigSchema.parse(cfg);
    expect(ok.headline).toBe("Helloevil");
    // Unknown keys (e.g. an attempted "html" field) are stripped.
    const withHtml = campaignConfigSchema.parse({ ...cfg, html: "<script>alert(1)</script>" }) as any;
    expect(withHtml.html).toBeUndefined();
  });

  it("only allows media from uploads, demo assets or public https", () => {
    const cfg = cloneTemplate("floating-products") as any;
    cfg.decor.assets[0].url = "/uploads/../../etc/passwd";
    expect(campaignConfigSchema.safeParse(cfg).success).toBe(false);
    cfg.decor.assets[0].url = "data:image/svg+xml,<svg onload=alert(1)>";
    expect(campaignConfigSchema.safeParse(cfg).success).toBe(false);
  });
});
