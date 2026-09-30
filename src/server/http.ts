import { cookies, headers } from "next/headers";
import { NextResponse } from "next/server";
import { AuthError, SESSION_COOKIE, userForSession, type User } from "./auth.ts";
import { CampaignError } from "./campaigns.ts";
import { PurchaseError } from "./payments/service.ts";
import { UploadError } from "./uploads.ts";
import { rateLimit } from "./ratelimit.ts";

export async function currentUser(): Promise<User | null> {
  const jar = await cookies();
  return userForSession(jar.get(SESSION_COOKIE)?.value);
}

export async function requireUser(): Promise<User> {
  const u = await currentUser();
  if (!u) throw new AuthError("Sign in required");
  return u;
}

export async function clientIp(): Promise<string> {
  const h = await headers();
  return (h.get("x-forwarded-for")?.split(",")[0] ?? h.get("x-real-ip") ?? "local").trim();
}

export class HttpError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

export async function limit(bucket: string, max: number, windowMs: number): Promise<void> {
  const ip = await clientIp();
  if (!rateLimit(`${bucket}:${ip}`, max, windowMs)) throw new HttpError("Too many requests. Slow down a little.", 429);
}

/**
 * Mutating requests must come from this origin. Combined with SameSite=Lax
 * cookies this blocks cross-site request forgery.
 */
export async function assertSameOrigin(req: Request): Promise<void> {
  const origin = req.headers.get("origin");
  if (!origin) return; // same-origin fetches from older browsers / server tools
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  try {
    if (new URL(origin).host !== host) throw new HttpError("Cross-origin request refused", 403);
  } catch (e) {
    if (e instanceof HttpError) throw e;
    throw new HttpError("Bad origin", 403);
  }
}

export function json(data: unknown, init?: number | ResponseInit) {
  const r = typeof init === "number" ? { status: init } : init;
  return NextResponse.json(data, { ...r, headers: { "Cache-Control": "no-store", ...(r?.headers ?? {}) } });
}

/** Wraps a route handler with consistent error mapping. */
export function handle<A extends unknown[]>(fn: (...args: A) => Promise<Response>) {
  return async (...args: A): Promise<Response> => {
    try {
      const req = args[0];
      if (req instanceof Request && req.method !== "GET" && req.method !== "HEAD") await assertSameOrigin(req);
      return await fn(...args);
    } catch (e) {
      if (e instanceof PurchaseError) return json({ error: e.message, code: e.code, ...e.data }, e.status);
      if (e instanceof CampaignError) return json({ error: e.message, issues: e.issues }, e.status);
      if (e instanceof AuthError || e instanceof HttpError || e instanceof UploadError) return json({ error: e.message }, e.status);
      console.error(e);
      return json({ error: "Something went wrong on our side." }, 500);
    }
  };
}

export async function readJson<T = Record<string, unknown>>(req: Request, maxBytes = 64 * 1024): Promise<T> {
  const text = await req.text();
  if (text.length > maxBytes) throw new HttpError("Request too large", 413);
  try {
    return JSON.parse(text || "{}") as T;
  } catch {
    throw new HttpError("Invalid JSON", 400);
  }
}
