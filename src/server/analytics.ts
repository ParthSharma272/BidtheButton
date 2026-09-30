import { config } from "./config.ts";
import { getDb, type DB } from "./db.ts";
import { getReign, type ReignRow } from "./ownership.ts";
import { cpcPaise, cpmPaise, ctr } from "./pricing.ts";

/**
 * Privacy-conscious analytics.
 *
 * - Visitors are identified only by a random client id held in their browser
 *   (shared across tabs). No IPs, no fingerprinting, nothing stored beyond the
 *   event type, the reign it belongs to, a coarse device class and the
 *   referring host.
 * - Every event carries the reign_id the visitor ACTUALLY had on screen, so a
 *   takeover mid-video still credits the campaign they opened.
 * - Nothing here ever invents a number. Where something cannot be measured the
 *   API returns null and the UI says so.
 */

export const EVENT_TYPES = [
  "campaign_view",
  "button_press",
  "experience_view",
  "experience_time",
  "outbound_click",
  "video_start",
  "video_complete",
] as const;
export type EventType = (typeof EVENT_TYPES)[number];

/** Dedupe windows per event type (ms). null = never deduplicated. */
const DEDUPE_MS: Record<EventType, number | null> = {
  campaign_view: config.viewDedupeMs,
  button_press: config.pressDedupeMs,
  experience_view: config.pressDedupeMs,
  experience_time: null,
  outbound_click: config.pressDedupeMs,
  video_start: config.viewDedupeMs,
  video_complete: config.viewDedupeMs,
};

const BOT_UA = /bot|crawl|spider|slurp|headless|lighthouse|preview|facebookexternalhit|embedly|curl|wget|python-requests|httpclient/i;

export function isBot(ua: string | null | undefined): boolean {
  if (!ua) return true;
  return BOT_UA.test(ua);
}

export function deviceClass(ua: string | null | undefined): "mobile" | "tablet" | "desktop" | "unknown" {
  if (!ua) return "unknown";
  if (/ipad|tablet|playbook|silk/i.test(ua)) return "tablet";
  if (/mobi|iphone|android/i.test(ua)) return "mobile";
  return "desktop";
}

export function referrerHost(ref: string | null | undefined, selfHost?: string | null): string | null {
  if (!ref) return null;
  try {
    const h = new URL(ref).hostname.replace(/^www\./, "");
    if (selfHost && h === selfHost.replace(/^www\./, "").split(":")[0]) return null;
    return h.slice(0, 100);
  } catch {
    return null;
  }
}

export interface RecordInput {
  type: EventType;
  reignId: string;
  clientId: string;
  value?: number;
  userAgent?: string | null;
  referrer?: string | null;
  now?: number;
}

/**
 * Records an event if it is valid and not a duplicate. Returns whether a row
 * was written.
 */
export function recordEvent(input: RecordInput, db: DB = getDb()): { recorded: boolean; reason?: string } {
  if (!EVENT_TYPES.includes(input.type)) return { recorded: false, reason: "bad_type" };
  if (!/^[A-Za-z0-9_-]{8,64}$/.test(input.clientId)) return { recorded: false, reason: "bad_client" };
  if (isBot(input.userAgent)) return { recorded: false, reason: "bot" };

  const reign = getReign(input.reignId, db);
  if (!reign) return { recorded: false, reason: "unknown_reign" };
  const now = input.now ?? Date.now();
  // Events may arrive for a reign that just ended (someone was mid-video when a
  // takeover happened). Accept them for a short grace period, never later.
  if (reign.ended_at && now - reign.ended_at > 15 * 60 * 1000) return { recorded: false, reason: "reign_closed" };

  let value: number | null = null;
  if (input.type === "experience_time") {
    if (typeof input.value !== "number" || !Number.isFinite(input.value)) return { recorded: false, reason: "bad_value" };
    value = Math.max(0, Math.min(Math.round(input.value), 10 * 60 * 1000));
    if (value < 250) return { recorded: false, reason: "too_short" };
  }

  const window = DEDUPE_MS[input.type];
  return db.transaction(() => {
    if (window !== null) {
      const key = `${input.type}:${input.reignId}:${input.clientId}`;
      const prev = db.prepare("SELECT created_at FROM event_dedupe WHERE key = ?").get(key) as { created_at: number } | undefined;
      if (prev && now - prev.created_at < window) return { recorded: false, reason: "duplicate" };
      db.prepare("INSERT INTO event_dedupe (key, created_at) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET created_at = excluded.created_at").run(key, now);
    }
    db.prepare(
      `INSERT INTO events (ts, type, reign_id, campaign_id, client_id, value, device, referrer, is_demo)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(now, input.type, reign.id, reign.campaign_id, input.clientId, value, deviceClass(input.userAgent), input.type === "campaign_view" ? (input.referrer ?? null) : null, reign.is_demo);
    return { recorded: true };
  })();
}

// ------------------------------------------------------------------ presence

export function heartbeat(clientId: string, visible: boolean, reignId: string | null, db: DB = getDb(), now = Date.now()): void {
  if (!/^[A-Za-z0-9_-]{8,64}$/.test(clientId)) return;
  db.prepare(
    `INSERT INTO presence (client_id, last_seen, visible, reign_id) VALUES (?, ?, ?, ?)
     ON CONFLICT(client_id) DO UPDATE SET last_seen = excluded.last_seen, visible = excluded.visible, reign_id = excluded.reign_id`,
  ).run(clientId, now, visible ? 1 : 0, reignId);
}

export function leave(clientId: string, db: DB = getDb()): void {
  db.prepare("DELETE FROM presence WHERE client_id = ?").run(clientId);
}

/** Distinct browsers with a visible page and a heartbeat inside the TTL. */
export function watchingNow(db: DB = getDb(), now = Date.now()): number {
  const r = db.prepare("SELECT COUNT(*) AS n FROM presence WHERE visible = 1 AND last_seen > ?").get(now - config.presenceTtlMs) as { n: number };
  return r.n;
}

export function samplePeak(reignId: string | null, watching: number, db: DB = getDb(), now = Date.now()): void {
  if (!reignId) return;
  db.prepare(
    `INSERT INTO presence_peaks (reign_id, peak, peak_at) VALUES (?, ?, ?)
     ON CONFLICT(reign_id) DO UPDATE SET peak = excluded.peak, peak_at = excluded.peak_at WHERE excluded.peak > presence_peaks.peak`,
  ).run(reignId, watching, now);
}

// ------------------------------------------------------------------ metrics

export interface ReignCounters {
  views: number;
  presses: number;
  experienceViews: number;
  outboundClicks: number;
}

export function reignCounters(reignId: string, db: DB = getDb()): ReignCounters {
  const rows = db.prepare("SELECT type, COUNT(*) AS n FROM events WHERE reign_id = ? GROUP BY type").all(reignId) as { type: EventType; n: number }[];
  const by = Object.fromEntries(rows.map((r) => [r.type, r.n])) as Partial<Record<EventType, number>>;
  return {
    views: by.campaign_view ?? 0,
    presses: by.button_press ?? 0,
    experienceViews: by.experience_view ?? 0,
    outboundClicks: by.outbound_click ?? 0,
  };
}

function trendBuckets(reign: ReignRow, db: DB, now: number) {
  const end = reign.ended_at ?? now;
  const span = Math.max(end - reign.started_at, 60_000);
  // Aim for ~24 buckets, snapped to friendly sizes.
  const sizes = [60_000, 5 * 60_000, 15 * 60_000, 60 * 60_000, 6 * 60 * 60_000, 24 * 60 * 60_000];
  const bucketMs = sizes.find((s) => span / s <= 30) ?? sizes[sizes.length - 1];
  const rows = db
    .prepare(
      `SELECT ((ts - ?) / ?) AS b, type, COUNT(*) AS n FROM events
       WHERE reign_id = ? AND type IN ('campaign_view','button_press','outbound_click') GROUP BY b, type`,
    )
    .all(reign.started_at, bucketMs, reign.id) as { b: number; type: string; n: number }[];
  const count = Math.min(Math.ceil(span / bucketMs), 60);
  const buckets = Array.from({ length: count }, (_, i) => ({ t: reign.started_at + i * bucketMs, views: 0, presses: 0, clicks: 0 }));
  for (const r of rows) {
    const bucket = buckets[Math.min(Math.floor(r.b), count - 1)];
    if (!bucket) continue;
    if (r.type === "campaign_view") bucket.views += r.n;
    else if (r.type === "button_press") bucket.presses += r.n;
    else bucket.clicks += r.n;
  }
  return { bucketMs, buckets };
}

/** Full private analytics for one reign. Every figure derives from stored rows. */
export function reignAnalytics(reignId: string, db: DB = getDb(), now = Date.now()) {
  const reign = getReign(reignId, db);
  if (!reign) return null;
  const c = reignCounters(reignId, db);
  const q = <T>(sql: string, ...args: unknown[]) => db.prepare(sql).get(reignId, ...args) as T;

  const uniques = q<{ n: number }>("SELECT COUNT(DISTINCT client_id) AS n FROM events WHERE reign_id = ? AND type = 'campaign_view'").n;
  const time = q<{ avg: number | null; n: number }>("SELECT AVG(value) AS avg, COUNT(*) AS n FROM events WHERE reign_id = ? AND type = 'experience_time'");
  const videoStarts = q<{ n: number }>("SELECT COUNT(*) AS n FROM events WHERE reign_id = ? AND type = 'video_start'").n;
  const videoCompletes = q<{ n: number }>("SELECT COUNT(*) AS n FROM events WHERE reign_id = ? AND type = 'video_complete'").n;
  const peak = db.prepare("SELECT peak, peak_at FROM presence_peaks WHERE reign_id = ?").get(reignId) as { peak: number; peak_at: number } | undefined;
  const devices = db
    .prepare("SELECT COALESCE(device,'unknown') AS device, COUNT(*) AS n FROM events WHERE reign_id = ? AND type = 'campaign_view' GROUP BY device ORDER BY n DESC")
    .all(reignId) as { device: string; n: number }[];
  const referrers = db
    .prepare(
      "SELECT COALESCE(referrer,'(direct / unknown)') AS host, COUNT(*) AS n FROM events WHERE reign_id = ? AND type = 'campaign_view' GROUP BY host ORDER BY n DESC LIMIT 8",
    )
    .all(reignId) as { host: string; n: number }[];

  const cfg = JSON.parse(reign.config_snapshot_json);
  const hasVideo = cfg?.experience?.type === "video" || cfg?.experience?.type === "youtube";

  return {
    reignId: reign.id,
    ordinal: reign.ordinal,
    campaignId: reign.campaign_id,
    brandName: cfg?.brand?.name ?? "",
    amountPaise: reign.amount_paise,
    startedAt: reign.started_at,
    endedAt: reign.ended_at,
    durationMs: (reign.ended_at ?? now) - reign.started_at,
    isDemo: !!reign.is_demo,
    ...c,
    uniqueVisitorsEstimate: uniques,
    ctr: ctr(c.outboundClicks, c.experienceViews),
    avgEngagedMs: time.avg === null ? null : Math.round(time.avg),
    engagedSamples: time.n,
    // YouTube's iframe does not report completions to us without its JS API;
    // report what we can actually observe.
    video: hasVideo
      ? { measurable: cfg.experience.type === "video", starts: cfg.experience.type === "video" ? videoStarts : null, completions: cfg.experience.type === "video" ? videoCompletes : null }
      : null,
    peakConcurrent: peak ? { value: peak.peak, at: peak.peak_at } : null,
    devices,
    referrers,
    cpmPaise: cpmPaise(reign.amount_paise, c.views),
    cpcPaise: cpcPaise(reign.amount_paise, c.outboundClicks),
    trend: trendBuckets(reign, db, now),
  };
}

export function ownerAnalytics(userId: string, db: DB = getDb()) {
  const reigns = db.prepare("SELECT id FROM reigns WHERE user_id = ? ORDER BY started_at DESC LIMIT 50").all(userId) as { id: string }[];
  return reigns.map((r) => reignAnalytics(r.id, db)!).filter(Boolean);
}
