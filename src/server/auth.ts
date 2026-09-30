import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { config } from "./config.ts";
import { getDb, newId, type DB } from "./db.ts";

export interface User {
  id: string;
  email: string;
  display_name: string;
  avatar_url: string | null;
  role: "user" | "admin";
  verified: number;
  is_demo: number;
}

export const SESSION_COOKIE = "tb_session";

export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, 32);
  return `scrypt$${salt.toString("hex")}$${hash.toString("hex")}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [scheme, saltHex, hashHex] = stored.split("$");
  if (scheme !== "scrypt" || !saltHex || !hashHex) return false;
  const expected = Buffer.from(hashHex, "hex");
  const actual = scryptSync(password, Buffer.from(saltHex, "hex"), expected.length);
  return timingSafeEqual(expected, actual);
}

const USER_COLS = "id, email, display_name, avatar_url, role, verified, is_demo";

export function createUser(
  input: { email: string; password: string; displayName: string; role?: "user" | "admin"; isDemo?: boolean; verified?: boolean },
  db: DB = getDb(),
): User {
  const id = newId("usr");
  db.prepare(
    `INSERT INTO users (id, email, password_hash, display_name, role, verified, is_demo, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    input.email.trim().toLowerCase(),
    hashPassword(input.password),
    input.displayName,
    input.role ?? "user",
    input.verified ? 1 : 0,
    input.isDemo ? 1 : 0,
    Date.now(),
  );
  return getUser(id, db)!;
}

export function getUser(id: string, db: DB = getDb()): User | null {
  return (db.prepare(`SELECT ${USER_COLS} FROM users WHERE id = ?`).get(id) as User | undefined) ?? null;
}

export function authenticate(email: string, password: string, db: DB = getDb()): User | null {
  const row = db
    .prepare(`SELECT ${USER_COLS}, password_hash FROM users WHERE email = ?`)
    .get(email.trim().toLowerCase()) as (User & { password_hash: string }) | undefined;
  if (!row || !verifyPassword(password, row.password_hash)) return null;
  const { password_hash: _ignored, ...user } = row;
  return user;
}

export function createSession(userId: string, db: DB = getDb()): { id: string; expiresAt: number } {
  const id = randomBytes(32).toString("base64url");
  const now = Date.now();
  const expiresAt = now + config.sessionTtlMs;
  db.prepare("INSERT INTO sessions (id, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)").run(id, userId, now, expiresAt);
  return { id, expiresAt };
}

export function userForSession(sessionId: string | undefined, db: DB = getDb()): User | null {
  if (!sessionId) return null;
  const row = db
    .prepare(
      `SELECT u.id, u.email, u.display_name, u.avatar_url, u.role, u.verified, u.is_demo
       FROM sessions s JOIN users u ON u.id = s.user_id
       WHERE s.id = ? AND s.expires_at > ?`,
    )
    .get(sessionId, Date.now()) as User | undefined;
  return row ?? null;
}

export function deleteSession(sessionId: string, db: DB = getDb()): void {
  db.prepare("DELETE FROM sessions WHERE id = ?").run(sessionId);
}

export class AuthError extends Error {
  status: number;
  constructor(message: string, status = 401) {
    super(message);
    this.status = status;
  }
}

export function requireAdmin(user: User | null): User {
  if (!user) throw new AuthError("Sign in required");
  if (user.role !== "admin") throw new AuthError("Administrator only", 403);
  return user;
}
