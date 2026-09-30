import Database from "better-sqlite3";
import { readFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

const DB_PATH = process.env.DATABASE_PATH ?? path.join(process.cwd(), "data", "app.db");

// Next.js re-evaluates modules on HMR. Park the handle on globalThis so a dev
// session keeps one connection instead of leaking a new one per reload.
const g = globalThis as unknown as { __button_db?: Database.Database };

export function getDb(): Database.Database {
  if (g.__button_db) return g.__button_db;

  mkdirSync(path.dirname(DB_PATH), { recursive: true });
  const db = new Database(DB_PATH);

  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  // Wait rather than fail when another writer holds the lock. Ownership
  // transfers take a write lock; competing buyers must queue, not error.
  db.pragma("busy_timeout = 5000");
  db.pragma("synchronous = NORMAL");

  migrate(db);
  g.__button_db = db;
  return db;
}

/** Applies schema.sql. Idempotent — every statement is CREATE ... IF NOT EXISTS. */
export function migrate(db: Database.Database): void {
  const schemaPath = path.join(process.cwd(), "src", "server", "schema.sql");
  db.exec(readFileSync(schemaPath, "utf8"));

  const row = db.prepare("SELECT COUNT(*) AS n FROM ownership_state WHERE id = 1").get() as {
    n: number;
  };
  if (row.n === 0) {
    db.prepare(
      `INSERT INTO ownership_state (id, version, current_reign_id, last_amount_paise, takeover_count, updated_at)
       VALUES (1, 0, NULL, 0, 0, ?)`,
    ).run(Date.now());
  }
  db.prepare("INSERT OR IGNORE INTO schema_migrations (version, applied_at) VALUES (1, ?)").run(
    Date.now(),
  );
}

/**
 * Runs `fn` inside an IMMEDIATE transaction, so the write lock is taken up
 * front rather than on first write. This is what serialises competing
 * ownership activations.
 */
export function txImmediate<T>(fn: (db: Database.Database) => T, db = getDb()): T {
  const wrapped = db.transaction(fn as (d: Database.Database) => T);
  return wrapped.immediate(db);
}

export const newId = (prefix: string): string => `${prefix}_${randomUUID().replace(/-/g, "").slice(0, 22)}`;

export function audit(
  action: string,
  subjectType: string,
  subjectId: string,
  detail: unknown,
  actorUserId?: string | null,
  db = getDb(),
): void {
  db.prepare(
    `INSERT INTO audit_log (ts, actor_user_id, action, subject_type, subject_id, detail_json)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(Date.now(), actorUserId ?? null, action, subjectType, subjectId, JSON.stringify(detail ?? null));
}

/** Test helper: an isolated in-memory database with the full schema applied. */
export function createTestDb(): Database.Database {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  migrate(db);
  return db;
}

export type DB = Database.Database;
