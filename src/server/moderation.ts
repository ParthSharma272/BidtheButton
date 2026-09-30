import { audit, getDb, newId, type DB } from "./db.ts";

export const REPORT_REASONS = [
  "phishing_or_scam",
  "impersonation",
  "malicious_link",
  "harassment_or_hate",
  "sexual_content",
  "violence",
  "copyright",
  "other",
] as const;
export type ReportReason = (typeof REPORT_REASONS)[number];

export function createReport(
  input: { reignId: string; reason: ReportReason; detail?: string; userId?: string | null; clientId?: string | null },
  db: DB = getDb(),
): { id: string } {
  const reign = db.prepare("SELECT id, campaign_id FROM reigns WHERE id = ?").get(input.reignId) as { id: string; campaign_id: string } | undefined;
  if (!reign) throw new Error("Unknown reign");
  if (!REPORT_REASONS.includes(input.reason)) throw new Error("Unknown reason");
  // One open report per reporter per reign — repeated clicks don't flood the queue.
  const who = input.userId ?? input.clientId ?? null;
  if (who) {
    const dup = db
      .prepare("SELECT id FROM reports WHERE reign_id = ? AND status = 'open' AND (reporter_user_id = ? OR reporter_client = ?)")
      .get(reign.id, who, who) as { id: string } | undefined;
    if (dup) return { id: dup.id };
  }
  const id = newId("rpt");
  db.prepare(
    `INSERT INTO reports (id, reign_id, campaign_id, reporter_user_id, reporter_client, reason, detail, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(id, reign.id, reign.campaign_id, input.userId ?? null, input.clientId ?? null, input.reason, (input.detail ?? "").slice(0, 1000) || null, Date.now());
  return { id };
}

export function resolveReport(adminId: string, reportId: string, status: "actioned" | "dismissed", resolution: string, db: DB = getDb()): void {
  db.prepare("UPDATE reports SET status = ?, resolution = ?, resolved_at = ? WHERE id = ?").run(status, resolution.slice(0, 500), Date.now(), reportId);
  audit("report.resolved", "report", reportId, { status, resolution }, adminId, db);
}

export function moderationQueue(db: DB = getDb()) {
  const pending = db
    .prepare(
      `SELECT c.id, c.name, c.status, c.draft_json, c.config_json, c.submitted_at, c.is_demo, u.display_name AS owner, u.email
       FROM campaigns c JOIN users u ON u.id = c.user_id WHERE c.status = 'pending_review' ORDER BY c.submitted_at ASC`,
    )
    .all();
  const reports = db
    .prepare(
      `SELECT r.*, c.name AS campaign_name, c.status AS campaign_status, rg.ordinal, rg.ended_at IS NULL AS live
       FROM reports r JOIN campaigns c ON c.id = r.campaign_id LEFT JOIN reigns rg ON rg.id = r.reign_id
       WHERE r.status IN ('open','reviewing') ORDER BY r.created_at DESC LIMIT 100`,
    )
    .all();
  const suspended = db
    .prepare(`SELECT c.id, c.name, c.review_note, c.suspended_at, u.display_name AS owner FROM campaigns c JOIN users u ON u.id = c.user_id WHERE c.status = 'suspended'`)
    .all();
  const payments = db
    .prepare(
      `SELECT p.id, p.state, p.amount_paise, p.total_paise, p.failure_reason, p.provider, p.is_demo, p.created_at, p.updated_at, u.display_name AS buyer
       FROM payments p JOIN users u ON u.id = p.user_id ORDER BY p.updated_at DESC LIMIT 50`,
    )
    .all();
  const auditLog = db.prepare("SELECT * FROM audit_log ORDER BY id DESC LIMIT 80").all();
  return { pending, reports, suspended, payments, auditLog };
}
