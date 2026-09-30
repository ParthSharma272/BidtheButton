/**
 * DEMO SEED. Everything created here is flagged is_demo = 1 and labelled
 * "Demo" in the UI. Refuses to run unless the mock payment provider is active,
 * so demo data can't be mixed into a real-payments database.
 *
 * Past reigns get synthetic, clearly-flagged demo engagement so the Book of
 * Owners and records have something to show. The CURRENT reign starts with
 * zero events: every number you see on it live is real.
 */
import { getDb, newId, txImmediate, type DB } from "../db.ts";
import { createUser } from "../auth.ts";
import { approveCampaign, createCampaign, submitCampaign } from "../campaigns.ts";
import { activateReign, getOwnershipState } from "../ownership.ts";
import { priceBreakdown } from "../pricing.ts";
import type { CampaignConfig } from "../campaign-schema.ts";
import { cloneTemplate } from "../../shared/templates.ts";

if ((process.env.PAYMENT_PROVIDER ?? "mock") !== "mock") {
  console.error("Refusing to seed demo data while PAYMENT_PROVIDER is not 'mock'.");
  process.exit(1);
}

const db = getDb();
const existing = db.prepare("SELECT COUNT(*) AS n FROM users").get() as { n: number };
if (existing.n > 0 && !process.argv.includes("--force")) {
  console.log("Database already has data. Run `npm run reset` for a clean demo, or pass --force.");
  process.exit(0);
}

const PASSWORD = "demo1234";
const H = 3_600_000;
const now = Date.now();

const admin = createUser({ email: "admin@demo.test", password: PASSWORD, displayName: "Moderator (demo)", role: "admin", isDemo: true }, db);
const nova = createUser({ email: "nova@demo.test", password: PASSWORD, displayName: "Nova Beverages", isDemo: true }, db);
const luna = createUser({ email: "luna@demo.test", password: PASSWORD, displayName: "Luna Voss", isDemo: true }, db);
const orbit = createUser({ email: "orbit@demo.test", password: PASSWORD, displayName: "Orbit Labs", isDemo: true }, db);
const you = createUser({ email: "you@demo.test", password: PASSWORD, displayName: "Kiran", isDemo: true }, db);

// ------------------------------------------------------------------ campaigns

const novaCfg: CampaignConfig = {
  ...cloneTemplate("floating-products"),
  brand: { name: "NOVA COLA" },
  headline: "Taste the loudest blue on the internet",
  subhead: "Ice-cold, zero sugar, extremely blue. Press it — we dare you.",
  decor: {
    preset: "float",
    intensity: 0.75,
    assets: [
      { url: "/demo/nova-bottle.svg", x: 13, y: 34, size: 26, rotation: -14, depth: 0.85, opacity: 1, alt: "A Nova Cola bottle" },
      { url: "/demo/nova-can.svg", x: 86, y: 30, size: 20, rotation: 12, depth: 0.6, opacity: 1, alt: "A can of Nova Cola Zero" },
      { url: "/demo/nova-bottle.svg", x: 90, y: 74, size: 14, rotation: 24, depth: 0.3, opacity: 0.8 },
      { url: "/demo/nova-can.svg", x: 8, y: 78, size: 12, rotation: -26, depth: 0.25, opacity: 0.75 },
      { url: "/demo/nova-can.svg", x: 70, y: 12, size: 8, rotation: 40, depth: 0.15, opacity: 0.55 },
    ],
  },
  experience: {
    type: "image",
    imageUrl: "/demo/nova-poster.svg",
    title: "Nova Cola Zero — now ice-cold everywhere",
    description: "Nova Cola is a fictional drink created for THE BUTTON demo.",
    ctaLabel: "Find a store",
    ctaUrl: "https://example.com/nova-cola",
  },
  socials: [],
};

const lunaCfg: CampaignConfig = {
  ...cloneTemplate("neon-music"),
  brand: { name: "LUNA VOSS" },
  headline: "Midnight Static — out Friday",
  subhead: "The new single. Press play before the rest of the internet does.",
  button: { label: "Play teaser", shape: "circle", color: "#ff2bd6", textColor: "#12021f", animation: "glow" },
  decor: {
    preset: "orbit",
    intensity: 0.6,
    assets: [
      { url: "/demo/luna-cover.svg", x: 76, y: 46, size: 42, rotation: 0, depth: 0.4, opacity: 1, alt: "Midnight Static album artwork" },
      { url: "/demo/luna-cover.svg", x: 10, y: 20, size: 9, rotation: -12, depth: 0.2, opacity: 0.35 },
    ],
  },
  experience: {
    type: "video",
    videoUrl: "/demo/luna-teaser.mp4",
    posterUrl: "/demo/luna-teaser-poster.jpg",
    title: "Midnight Static (teaser)",
    description: "Luna Voss is a fictional artist created for THE BUTTON demo.",
    ctaLabel: "Pre-save the single",
    ctaUrl: "https://example.com/luna-voss",
  },
  socials: [],
};

const orbitCfg: CampaignConfig = {
  ...cloneTemplate("minimal-launch"),
  brand: { name: "Orbit Notes" },
  headline: "The calmest way to ship.",
  subhead: "Orbit Notes launches today — plans, notes and focus in one quiet app.",
  decor: {
    preset: "drift",
    intensity: 0.35,
    assets: [
      { url: "/demo/orbit-screen-1.svg", x: 17, y: 66, size: 34, rotation: -4, depth: 0.3, opacity: 1, alt: "Orbit Notes desktop app" },
      { url: "/demo/orbit-screen-2.svg", x: 89, y: 60, size: 28, rotation: 5, depth: 0.5, opacity: 1, alt: "Orbit Notes mobile app" },
    ],
  },
  experience: {
    type: "link",
    url: "https://example.com/orbit-notes",
    title: "Orbit Notes — launch day",
    description: "Plans, notes and focus in one quiet app. Orbit Notes is a fictional product created for THE BUTTON demo.",
    imageUrl: "/demo/orbit-og.svg",
    ctaLabel: "Try Orbit Notes",
  },
  socials: [],
};

const kiranCfg: CampaignConfig = {
  ...cloneTemplate("playful-creator"),
  brand: { name: "Kiran's Corner", logoUrl: "/demo/kiran-avatar.svg" },
  headline: "I bought the internet's button!!",
  subhead: "Hi, I'm Kiran. I make tiny, weird browser games. This is my moment.",
  button: { label: "Read my note", shape: "squircle", color: "#1d1033", textColor: "#ffd23f", animation: "pulse" },
  experience: {
    type: "message",
    title: "A note from Kiran",
    body: "If you're reading this, you're my favourite person today. Go make something small and weird.",
    ctaLabel: "Play my games",
    ctaUrl: "https://example.com/kiran",
  },
};

function approved(userId: string, name: string, cfg: CampaignConfig) {
  const c = createCampaign(userId, name, cfg, { isDemo: true }, db);
  submitCampaign(userId, c.id, db);
  approveCampaign(admin.id, c.id, db);
  return c;
}

const cNova = approved(nova.id, "Nova Cola — Loudest Blue", novaCfg);
const cLuna = approved(luna.id, "Midnight Static release", lunaCfg);
const cOrbit = approved(orbit.id, "Orbit Notes launch", orbitCfg);
approved(you.id, "Kiran's Corner", kiranCfg);

// A second campaign for Kiran, waiting in the moderation queue.
const poster = createCampaign(
  you.id,
  "Poster idea",
  { ...cloneTemplate("bold-poster"), brand: { name: "Kiran" }, headline: "GO OUTSIDE", subhead: "(after you press the button)" },
  { isDemo: true },
  db,
);
submitCampaign(you.id, poster.id, db);

// ------------------------------------------------------------------ history

function seededTakeover(user: { id: string }, campaign: { id: string }, amountPaise: number, at: number, dbx: DB) {
  const cfgJson = (dbx.prepare("SELECT config_json FROM campaigns WHERE id = ?").get(campaign.id) as { config_json: string }).config_json;
  txImmediate((tx) => {
    const s = getOwnershipState(tx);
    const b = priceBreakdown(amountPaise);
    const quoteId = newId("qte");
    const paymentId = newId("pay");
    tx.prepare(
      `INSERT INTO quotes (id, user_id, campaign_id, ownership_version, min_amount_paise, amount_paise, fee_paise, tax_paise, total_paise, status, created_at, expires_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'consumed', ?, ?)`,
    ).run(quoteId, user.id, campaign.id, s.version, amountPaise, amountPaise, b.feePaise, b.taxPaise, b.totalPaise, at, at + 180_000);
    tx.prepare(
      `INSERT INTO payments (id, quote_id, user_id, campaign_id, provider, provider_ref, amount_paise, total_paise, state, is_demo, created_at, updated_at, captured_at, settled_at)
       VALUES (?, ?, ?, ?, 'mock', ?, ?, ?, 'captured', 1, ?, ?, ?, ?)`,
    ).run(paymentId, quoteId, user.id, campaign.id, `mockord_${paymentId}`, amountPaise, b.totalPaise, at, at, at, at);
    const reign = activateReign(tx, { expectedVersion: s.version, userId: user.id, campaignId: campaign.id, configJson: cfgJson, amountPaise, paymentId, isDemo: true, now: at });
    tx.prepare("UPDATE payments SET state = 'settled', reign_id = ? WHERE id = ?").run(reign.id, paymentId);
  }, dbx);
}

const t0 = now - 72 * H;
const plan: [typeof nova, typeof cNova, number, number][] = [
  [orbit, cOrbit, 1_000, t0],
  [luna, cLuna, 2_500, t0 + 5 * H],
  [orbit, cOrbit, 6_000, t0 + 19 * H],
  [luna, cLuna, 150_000, t0 + 28 * H],
  [nova, cNova, 242_000, now - 40 * 60_000],
];
for (const [u, c, amt, at] of plan) seededTakeover(u, c, amt, at, db);

// Synthetic engagement for COMPLETED demo reigns only.
let seed = 42;
const rand = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
const pick = <T,>(xs: [T, number][]) => {
  let r = rand();
  for (const [v, w] of xs) if ((r -= w) <= 0) return v;
  return xs[xs.length - 1][0];
};
const devices: [string, number][] = [["mobile", 0.62], ["desktop", 0.33], ["tablet", 0.05]];
const refs: [string | null, number][] = [[null, 0.5], ["x.com", 0.2], ["instagram.com", 0.15], ["news.ycombinator.com", 0.1], ["reddit.com", 0.05]];

const past = db.prepare("SELECT * FROM reigns WHERE ended_at IS NOT NULL ORDER BY ordinal").all() as { id: string; campaign_id: string; started_at: number; ended_at: number; config_snapshot_json: string }[];
const ins = db.prepare("INSERT INTO events (ts, type, reign_id, campaign_id, client_id, value, device, referrer, is_demo) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)");
db.transaction(() => {
  for (const r of past) {
    const hours = (r.ended_at - r.started_at) / H;
    const views = Math.round(hours * (90 + rand() * 80));
    const isVideo = JSON.parse(r.config_snapshot_json).experience.type === "video";
    for (let i = 0; i < views; i++) {
      const ts = r.started_at + Math.floor(rand() * (r.ended_at - r.started_at));
      const client = `demo_${r.id.slice(-6)}_${Math.floor(rand() * views * 0.72)}`;
      const device = pick(devices);
      ins.run(ts, "campaign_view", r.id, r.campaign_id, client, null, device, pick(refs));
      if (rand() < 0.36) {
        ins.run(ts + 3000, "button_press", r.id, r.campaign_id, client, null, device, null);
        ins.run(ts + 3100, "experience_view", r.id, r.campaign_id, client, null, device, null);
        ins.run(ts + 9000, "experience_time", r.id, r.campaign_id, client, Math.round(3000 + rand() * 22000), device, null);
        if (isVideo && rand() < 0.8) {
          ins.run(ts + 3500, "video_start", r.id, r.campaign_id, client, null, device, null);
          if (rand() < 0.45) ins.run(ts + 11500, "video_complete", r.id, r.campaign_id, client, null, device, null);
        }
        if (rand() < 0.11) ins.run(ts + 8000, "outbound_click", r.id, r.campaign_id, client, null, device, null);
      }
    }
    db.prepare("INSERT INTO presence_peaks (reign_id, peak, peak_at) VALUES (?, ?, ?)").run(r.id, 20 + Math.floor(rand() * 70), r.started_at + (r.ended_at - r.started_at) / 2);
  }
})();

const s = getOwnershipState(db);
console.log(`Seeded demo data: ${s.takeover_count} reigns, current owner NOVA COLA at ₹${s.last_amount_paise / 100}.`);
console.log("Demo logins (password demo1234): you@demo.test (buyer), admin@demo.test (moderator), nova@/luna@/orbit@demo.test (brands).");
