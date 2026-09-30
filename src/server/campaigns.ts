import type { ZodError } from "zod";
import { campaignConfigSchema, isMaterialChange, type CampaignConfig } from "./campaign-schema.ts";
import { config } from "./config.ts";
import { audit, getDb, newId, txImmediate, type DB } from "./db.ts";
import { publish } from "./bus.ts";

/**
 * Campaign publishing.
 *
 * - `draft_json` is the studio working copy. It is never rendered publicly.
 * - `config_json` is the last APPROVED version. Only this can be bought with.
 * - The public page renders the current reign's `config_snapshot_json`, which is
 *   only ever refreshed inside a transaction that re-checks the reign is still
 *   open and still belongs to this campaign's owner. An outbid owner therefore
 *   cannot change the live page, whatever state their campaign is in.
 */

export type CampaignStatus = "draft" | "pending_review" | "approved" | "rejected" | "suspended";

export interface CampaignRow {
  id: string;
  user_id: string;
  name: string;
  status: CampaignStatus;
  config_json: string | null;
  draft_json: string;
  review_note: string | null;
  submitted_at: number | null;
  approved_at: number | null;
  suspended_at: number | null;
  is_demo: number;
  created_at: number;
  updated_at: number;
}

export class CampaignError extends Error {
  status: number;
  issues?: { path: string; message: string }[];
  constructor(message: string, status = 400, issues?: { path: string; message: string }[]) {
    super(message);
    this.status = status;
    this.issues = issues;
  }
}

export function zodIssues(err: ZodError) {
  return err.issues.map((i) => ({ path: i.path.join("."), message: i.message }));
}

export function parseConfig(input: unknown): CampaignConfig {
  const r = campaignConfigSchema.safeParse(input);
  if (!r.success) throw new CampaignError("Campaign has invalid fields", 422, zodIssues(r.error));
  return r.data;
}

export function getCampaign(id: string, db: DB = getDb()): CampaignRow | null {
  return (db.prepare("SELECT * FROM campaigns WHERE id = ?").get(id) as CampaignRow | undefined) ?? null;
}

export function listCampaignsForUser(userId: string, db: DB = getDb()): CampaignRow[] {
  return db.prepare("SELECT * FROM campaigns WHERE user_id = ? ORDER BY updated_at DESC").all(userId) as CampaignRow[];
}

function ownedCampaign(userId: string, campaignId: string, db: DB): CampaignRow {
  const c = getCampaign(campaignId, db);
  if (!c || c.user_id !== userId) throw new CampaignError("Campaign not found", 404);
  return c;
}

export function createCampaign(
  userId: string,
  name: string,
  draft: unknown,
  opts: { isDemo?: boolean } = {},
  db: DB = getDb(),
): CampaignRow {
  const cfg = parseConfig(draft);
  const id = newId("cmp");
  const now = Date.now();
  db.prepare(
    `INSERT INTO campaigns (id, user_id, name, status, draft_json, is_demo, created_at, updated_at)
     VALUES (?, ?, ?, 'draft', ?, ?, ?, ?)`,
  ).run(id, userId, name.slice(0, 60) || cfg.brand.name, JSON.stringify(cfg), opts.isDemo ? 1 : 0, now, now);
  return getCampaign(id, db)!;
}

export function saveDraft(userId: string, campaignId: string, name: string | undefined, draft: unknown, db: DB = getDb()): CampaignRow {
  const c = ownedCampaign(userId, campaignId, db);
  if (c.status === "suspended") throw new CampaignError("This campaign is suspended by moderation", 403);
  const cfg = parseConfig(draft);
  // Editing a draft that was waiting for review pulls it back out of the queue:
  // reviewers must see exactly what will go live.
  const status: CampaignStatus = c.status === "pending_review" || c.status === "rejected" ? (c.config_json ? "approved" : "draft") : c.status;
  db.prepare("UPDATE campaigns SET name = ?, draft_json = ?, status = ?, updated_at = ? WHERE id = ?").run(
    (name ?? c.name).slice(0, 60),
    JSON.stringify(cfg),
    status,
    Date.now(),
    campaignId,
  );
  return getCampaign(campaignId, db)!;
}

export interface SubmitResult {
  campaign: CampaignRow;
  outcome: "queued" | "published_minor" | "approved";
}

/**
 * Submits the draft. Material changes go to the moderation queue. A purely
 * cosmetic edit (colour, position, animation) to an already-approved campaign
 * publishes immediately — nothing a visitor could be misled by has changed.
 */
export function submitCampaign(userId: string, campaignId: string, db: DB = getDb()): SubmitResult {
  const c = ownedCampaign(userId, campaignId, db);
  if (c.status === "suspended") throw new CampaignError("This campaign is suspended by moderation", 403);
  const draft = parseConfig(JSON.parse(c.draft_json));

  if (c.config_json) {
    const live = parseConfig(JSON.parse(c.config_json));
    if (!isMaterialChange(live, draft)) {
      approveInternal(c.id, null, db);
      audit("campaign.minor_publish", "campaign", c.id, null, userId, db);
      return { campaign: getCampaign(c.id, db)!, outcome: "published_minor" };
    }
  }

  const now = Date.now();
  db.prepare("UPDATE campaigns SET status = 'pending_review', submitted_at = ?, review_note = NULL, updated_at = ? WHERE id = ?").run(
    now,
    now,
    c.id,
  );
  audit("campaign.submitted", "campaign", c.id, null, userId, db);

  if (config.autoApprove) {
    approveInternal(c.id, null, db);
    return { campaign: getCampaign(c.id, db)!, outcome: "approved" };
  }
  return { campaign: getCampaign(c.id, db)!, outcome: "queued" };
}

/**
 * Promotes draft -> approved config and, if (and only if) this campaign is on
 * the currently open reign, refreshes that reign's live snapshot. The reign
 * check runs inside the same IMMEDIATE transaction as the write.
 */
function approveInternal(campaignId: string, adminId: string | null, db: DB): { liveUpdated: boolean } {
  const liveUpdated = txImmediate((tx) => {
    const c = getCampaign(campaignId, tx);
    if (!c) throw new CampaignError("Campaign not found", 404);
    if (c.status === "suspended") throw new CampaignError("Campaign is suspended", 409);
    const now = Date.now();
    tx.prepare(
      `UPDATE campaigns SET status = 'approved', config_json = draft_json, approved_at = ?, approved_by = ?, review_note = NULL, updated_at = ?
       WHERE id = ?`,
    ).run(now, adminId, now, campaignId);

    const res = tx
      .prepare(
        `UPDATE reigns SET config_snapshot_json = ?
         WHERE ended_at IS NULL AND campaign_id = ? AND user_id = ? AND suspended = 0`,
      )
      .run(c.draft_json, campaignId, c.user_id);
    if (res.changes > 0) audit("reign.live_config_updated", "campaign", campaignId, null, adminId ?? c.user_id, tx);
    return res.changes > 0;
  }, db);
  if (liveUpdated) publish({ type: "ownership", payload: { reason: "campaign_updated" } });
  return { liveUpdated };
}

export function approveCampaign(adminId: string, campaignId: string, db: DB = getDb()) {
  const r = approveInternal(campaignId, adminId, db);
  audit("campaign.approved", "campaign", campaignId, r, adminId, db);
  return r;
}

export function rejectCampaign(adminId: string, campaignId: string, note: string, db: DB = getDb()): void {
  const c = getCampaign(campaignId, db);
  if (!c) throw new CampaignError("Campaign not found", 404);
  if (c.status !== "pending_review") throw new CampaignError("Campaign is not awaiting review", 409);
  db.prepare("UPDATE campaigns SET status = 'rejected', review_note = ?, updated_at = ? WHERE id = ?").run(
    note.slice(0, 500),
    Date.now(),
    campaignId,
  );
  audit("campaign.rejected", "campaign", campaignId, { note }, adminId, db);
}

/**
 * Suspension replaces the live page with a neutral platform screen. Ownership,
 * payment and history rows are untouched: the reign keeps running, it just
 * stops rendering the owner's content.
 */
export function suspendCampaign(adminId: string, campaignId: string, reason: string, db: DB = getDb()): void {
  txImmediate((tx) => {
    const c = getCampaign(campaignId, tx);
    if (!c) throw new CampaignError("Campaign not found", 404);
    const now = Date.now();
    tx.prepare("UPDATE campaigns SET status = 'suspended', suspended_at = ?, review_note = ?, updated_at = ? WHERE id = ?").run(
      now,
      reason.slice(0, 500),
      now,
      campaignId,
    );
    tx.prepare("UPDATE reigns SET suspended = 1 WHERE campaign_id = ? AND ended_at IS NULL").run(campaignId);
    audit("campaign.suspended", "campaign", campaignId, { reason }, adminId, tx);
  }, db);
  publish({ type: "ownership", payload: { reason: "suspended" } });
}

export function reinstateCampaign(adminId: string, campaignId: string, db: DB = getDb()): void {
  txImmediate((tx) => {
    const c = getCampaign(campaignId, tx);
    if (!c || c.status !== "suspended") throw new CampaignError("Campaign is not suspended", 409);
    const now = Date.now();
    tx.prepare("UPDATE campaigns SET status = ?, suspended_at = NULL, updated_at = ? WHERE id = ?").run(
      c.config_json ? "approved" : "draft",
      now,
      campaignId,
    );
    tx.prepare("UPDATE reigns SET suspended = 0 WHERE campaign_id = ? AND ended_at IS NULL").run(campaignId);
    audit("campaign.reinstated", "campaign", campaignId, null, adminId, tx);
  }, db);
  publish({ type: "ownership", payload: { reason: "reinstated" } });
}

/** Whether a campaign may be used to buy the button right now. */
export function purchasableReason(c: CampaignRow): string | null {
  if (c.status === "suspended") return "This campaign is suspended by moderation.";
  if (!c.config_json) return "This campaign has not been approved yet.";
  return null;
}

export function publicCampaignSummary(c: CampaignRow) {
  const draft = JSON.parse(c.draft_json) as CampaignConfig;
  return {
    id: c.id,
    name: c.name,
    status: c.status,
    hasApprovedVersion: !!c.config_json,
    reviewNote: c.review_note,
    updatedAt: c.updated_at,
    isDemo: !!c.is_demo,
    draft,
    approved: c.config_json ? (JSON.parse(c.config_json) as CampaignConfig) : null,
  };
}
