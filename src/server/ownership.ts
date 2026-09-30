import { audit, getDb, newId, type DB } from "./db.ts";
import { minimumNextPurchasePaise } from "./pricing.ts";

/**
 * Ownership is a single-row state machine guarded by a monotonically increasing
 * `version`. The ONLY way ownership changes is `activateReign`, and it must be
 * called inside an IMMEDIATE transaction by the payment service after a
 * verified capture. The partial unique index `idx_one_active_reign` makes a
 * second open reign impossible at the storage layer, even if this code were
 * wrong.
 */

export interface OwnershipState {
  version: number;
  current_reign_id: string | null;
  last_amount_paise: number;
  takeover_count: number;
  updated_at: number;
}

export interface ReignRow {
  id: string;
  ordinal: number;
  user_id: string;
  campaign_id: string;
  config_snapshot_json: string;
  amount_paise: number;
  payment_id: string | null;
  started_at: number;
  ended_at: number | null;
  ended_reason: string | null;
  suspended: number;
  is_demo: number;
}

export function getOwnershipState(db: DB = getDb()): OwnershipState {
  return db.prepare("SELECT version, current_reign_id, last_amount_paise, takeover_count, updated_at FROM ownership_state WHERE id = 1").get() as OwnershipState;
}

export function getReign(id: string, db: DB = getDb()): ReignRow | null {
  return (db.prepare("SELECT * FROM reigns WHERE id = ?").get(id) as ReignRow | undefined) ?? null;
}

export function getReignByOrdinal(ordinal: number, db: DB = getDb()): ReignRow | null {
  return (db.prepare("SELECT * FROM reigns WHERE ordinal = ?").get(ordinal) as ReignRow | undefined) ?? null;
}

export function currentReign(db: DB = getDb()): ReignRow | null {
  return (db.prepare("SELECT * FROM reigns WHERE ended_at IS NULL").get() as ReignRow | undefined) ?? null;
}

export function currentMinimumPaise(db: DB = getDb()): number {
  return minimumNextPurchasePaise(getOwnershipState(db).last_amount_paise);
}

export class StaleOwnershipError extends Error {
  constructor() {
    super("Ownership changed since this quote was issued");
  }
}

/**
 * Transfers ownership. MUST run inside an IMMEDIATE transaction (`tx`).
 *
 * `expectedVersion` is the ownership version the buyer was quoted against. If
 * anything has changed since — another takeover, however recent — this throws
 * and nothing is written, so a delayed webhook can never overwrite a newer
 * owner.
 */
export function activateReign(
  tx: DB,
  input: {
    expectedVersion: number;
    userId: string;
    campaignId: string;
    configJson: string;
    amountPaise: number;
    paymentId: string | null;
    isDemo: boolean;
    now?: number;
  },
): ReignRow {
  if (!tx.inTransaction) throw new Error("activateReign must run inside a transaction");
  const now = input.now ?? Date.now();
  const state = getOwnershipState(tx);

  if (state.version !== input.expectedVersion) throw new StaleOwnershipError();
  if (input.amountPaise < minimumNextPurchasePaise(state.last_amount_paise)) throw new StaleOwnershipError();

  let previous: ReignRow | null = null;
  if (state.current_reign_id) {
    previous = getReign(state.current_reign_id, tx);
    tx.prepare("UPDATE reigns SET ended_at = ?, ended_reason = 'taken_over' WHERE id = ? AND ended_at IS NULL").run(now, state.current_reign_id);
  }

  const reignId = newId("rgn");
  const ordinal = state.takeover_count + 1;
  tx.prepare(
    `INSERT INTO reigns (id, ordinal, user_id, campaign_id, config_snapshot_json, amount_paise, payment_id, started_at, is_demo)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(reignId, ordinal, input.userId, input.campaignId, input.configJson, input.amountPaise, input.paymentId, now, input.isDemo ? 1 : 0);

  // Compare-and-set on version: belt and braces on top of the IMMEDIATE lock.
  const res = tx
    .prepare(
      `UPDATE ownership_state
       SET version = version + 1, current_reign_id = ?, last_amount_paise = ?, takeover_count = takeover_count + 1, updated_at = ?
       WHERE id = 1 AND version = ?`,
    )
    .run(reignId, input.amountPaise, now, input.expectedVersion);
  if (res.changes !== 1) throw new StaleOwnershipError();

  audit(
    "ownership.transferred",
    "reign",
    reignId,
    { fromReign: previous?.id ?? null, fromUser: previous?.user_id ?? null, toUser: input.userId, amountPaise: input.amountPaise, version: state.version + 1, paymentId: input.paymentId },
    input.userId,
    tx,
  );

  if (previous && previous.user_id !== input.userId) {
    tx.prepare("INSERT INTO notifications (id, user_id, title, body, created_at) VALUES (?, ?, ?, ?, ?)").run(
      newId("ntf"),
      previous.user_id,
      "You lost control of THE BUTTON",
      `Takeover #${ordinal} replaced your campaign. Your history and analytics are kept in your account.`,
      now,
    );
  }

  return getReign(reignId, tx)!;
}
