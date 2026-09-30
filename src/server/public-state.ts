import type { CampaignConfig } from "./campaign-schema.ts";
import { config, isDemoProvider } from "./config.ts";
import { getDb, type DB } from "./db.ts";
import { reignCounters, watchingNow, type ReignCounters } from "./analytics.ts";
import { getOwnershipState, getReign, type ReignRow } from "./ownership.ts";
import { minimumNextPurchasePaise } from "./pricing.ts";

/**
 * The public, server-authoritative snapshot of the page. Platform fields
 * (pricing, metrics, ownership disclosure) are computed here and rendered by
 * platform components; the owner's config only ever feeds the stage.
 */

export interface PublicReign {
  id: string;
  ordinal: number;
  owner: { id: string; name: string; verified: boolean };
  /** null when the campaign is suspended — the page shows a neutral screen. */
  config: CampaignConfig | null;
  suspended: boolean;
  amountPaise: number;
  startedAt: number;
  endedAt: number | null;
  isDemo: boolean;
}

export interface PublicState {
  serverTime: number;
  version: number;
  reign: PublicReign | null;
  counters: ReignCounters | null;
  lastAmountPaise: number;
  minNextPaise: number;
  takeoverCount: number;
  watching: number;
  recent: RecentTakeover[];
  platform: {
    demoMode: boolean;
    currency: "INR";
    firstPricePaise: number;
    minIncreaseBps: number;
    minIncreaseAbsolutePaise: number;
    feeBps: number;
    taxBps: number;
    heartbeatMs: number;
    minViewMs: number;
    seasonsEnabled: boolean;
  };
}

export interface RecentTakeover {
  ordinal: number;
  ownerName: string;
  brandName: string;
  amountPaise: number;
  startedAt: number;
  endedAt: number | null;
  primary: string;
}

export function toPublicReign(r: ReignRow, db: DB): PublicReign {
  const u = db.prepare("SELECT id, display_name, verified FROM users WHERE id = ?").get(r.user_id) as { id: string; display_name: string; verified: number };
  return {
    id: r.id,
    ordinal: r.ordinal,
    owner: { id: u.id, name: u.display_name, verified: !!u.verified },
    config: r.suspended ? null : (JSON.parse(r.config_snapshot_json) as CampaignConfig),
    suspended: !!r.suspended,
    amountPaise: r.amount_paise,
    startedAt: r.started_at,
    endedAt: r.ended_at,
    isDemo: !!r.is_demo,
  };
}

export function recentTakeovers(limit = 6, db: DB = getDb()): RecentTakeover[] {
  const rows = db
    .prepare(
      `SELECT r.ordinal, r.amount_paise, r.started_at, r.ended_at, r.suspended, r.config_snapshot_json, u.display_name
       FROM reigns r JOIN users u ON u.id = r.user_id ORDER BY r.ordinal DESC LIMIT ?`,
    )
    .all(limit) as { ordinal: number; amount_paise: number; started_at: number; ended_at: number | null; suspended: number; config_snapshot_json: string; display_name: string }[];
  return rows.map((r) => {
    const cfg = JSON.parse(r.config_snapshot_json) as CampaignConfig;
    return {
      ordinal: r.ordinal,
      ownerName: r.display_name,
      brandName: r.suspended ? "Suspended campaign" : cfg.brand.name,
      amountPaise: r.amount_paise,
      startedAt: r.started_at,
      endedAt: r.ended_at,
      primary: r.suspended ? "#555555" : cfg.theme.palette.primary,
    };
  });
}

export function getPublicState(db: DB = getDb()): PublicState {
  const s = getOwnershipState(db);
  const reign = s.current_reign_id ? getReign(s.current_reign_id, db) : null;
  return {
    serverTime: Date.now(),
    version: s.version,
    reign: reign ? toPublicReign(reign, db) : null,
    counters: reign ? reignCounters(reign.id, db) : null,
    lastAmountPaise: s.last_amount_paise,
    minNextPaise: minimumNextPurchasePaise(s.last_amount_paise),
    takeoverCount: s.takeover_count,
    watching: watchingNow(db),
    recent: recentTakeovers(6, db),
    platform: {
      demoMode: isDemoProvider(),
      currency: "INR",
      firstPricePaise: config.firstPricePaise,
      minIncreaseBps: config.minIncreaseBps,
      minIncreaseAbsolutePaise: config.minIncreaseAbsolutePaise,
      feeBps: config.feeBps,
      taxBps: config.taxBps,
      heartbeatMs: config.heartbeatMs,
      minViewMs: config.minViewMs,
      seasonsEnabled: config.seasonsEnabled,
    },
  };
}

// ------------------------------------------------------------------ history

export function bookOfOwners(limit = 100, db: DB = getDb()) {
  const rows = db.prepare("SELECT * FROM reigns ORDER BY ordinal DESC LIMIT ?").all(limit) as ReignRow[];
  const now = Date.now();
  return rows.map((r) => ({
    ...toPublicReign(r, db),
    durationMs: (r.ended_at ?? now) - r.started_at,
    ongoing: r.ended_at === null,
    counters: reignCounters(r.id, db),
  }));
}

export function records(db: DB = getDb()) {
  const now = Date.now();
  const q = (sql: string) => db.prepare(sql).get(now) as Record<string, unknown> | undefined;
  const brand = (json: unknown, suspended: unknown) => (suspended ? "Suspended campaign" : (JSON.parse(String(json)) as CampaignConfig).brand.name);

  const longest = q(
    `SELECT r.ordinal, r.config_snapshot_json AS cfg, r.suspended, u.display_name AS owner, (COALESCE(r.ended_at, ?) - r.started_at) AS v, r.ended_at IS NULL AS ongoing
     FROM reigns r JOIN users u ON u.id = r.user_id ORDER BY v DESC LIMIT 1`,
  );
  const highest = db
    .prepare(
      `SELECT r.ordinal, r.config_snapshot_json AS cfg, r.suspended, u.display_name AS owner, r.amount_paise AS v, r.ended_at IS NULL AS ongoing
       FROM reigns r JOIN users u ON u.id = r.user_id ORDER BY v DESC LIMIT 1`,
    )
    .get() as Record<string, unknown> | undefined;
  const byEvent = (type: string) =>
    db
      .prepare(
        `SELECT r.ordinal, r.config_snapshot_json AS cfg, r.suspended, u.display_name AS owner, COUNT(e.id) AS v, r.ended_at IS NULL AS ongoing
         FROM reigns r JOIN users u ON u.id = r.user_id JOIN events e ON e.reign_id = r.id AND e.type = ?
         GROUP BY r.id ORDER BY v DESC LIMIT 1`,
      )
      .get(type) as Record<string, unknown> | undefined;
  const mostTakeovers = db
    .prepare(
      `SELECT u.display_name AS owner, COUNT(*) AS v FROM reigns r JOIN users u ON u.id = r.user_id
       GROUP BY r.user_id ORDER BY v DESC, MIN(r.started_at) ASC LIMIT 1`,
    )
    .get() as { owner: string; v: number } | undefined;

  const fmt = (r: Record<string, unknown> | undefined) =>
    r ? { ordinal: Number(r.ordinal), owner: String(r.owner), brand: brand(r.cfg, r.suspended), value: Number(r.v), ongoing: !!r.ongoing } : null;

  return {
    longestReign: fmt(longest),
    highestPurchase: fmt(highest),
    mostViewed: fmt(byEvent("campaign_view")),
    mostClicked: fmt(byEvent("outbound_click")),
    mostTakeovers: mostTakeovers ? { owner: mostTakeovers.owner, value: mostTakeovers.v } : null,
  };
}

export function archivedReign(ordinal: number, db: DB = getDb()) {
  const r = db.prepare("SELECT * FROM reigns WHERE ordinal = ?").get(ordinal) as ReignRow | undefined;
  if (!r) return null;
  return { ...toPublicReign(r, db), durationMs: (r.ended_at ?? Date.now()) - r.started_at, ongoing: r.ended_at === null, counters: reignCounters(r.id, db) };
}
