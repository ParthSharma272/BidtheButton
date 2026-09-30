"use client";

/** Browser-side helpers. Nothing here is trusted by the server. */

export class ApiError extends Error {
  status: number;
  data: Record<string, any>;
  constructor(message: string, status: number, data: Record<string, any>) {
    super(message);
    this.status = status;
    this.data = data;
  }
}

export async function api<T = any>(path: string, init: RequestInit & { json?: unknown } = {}): Promise<T> {
  const { json: body, ...rest } = init;
  const res = await fetch(path, {
    ...rest,
    method: rest.method ?? (body !== undefined ? "POST" : "GET"),
    headers: body !== undefined ? { "Content-Type": "application/json", ...(rest.headers ?? {}) } : rest.headers,
    body: body !== undefined ? JSON.stringify(body) : rest.body,
    credentials: "same-origin",
    cache: "no-store",
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(data.error ?? `Request failed (${res.status})`, res.status, data);
  return data as T;
}

function safeStorage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

/** Random per-browser id, shared by all tabs, so presence dedupes tabs. */
export function getClientId(): string {
  const s = safeStorage();
  let id = s?.getItem("tb_client") ?? null;
  if (!id || !/^[A-Za-z0-9_-]{8,64}$/.test(id)) {
    id = "c_" + Array.from(crypto.getRandomValues(new Uint8Array(12)), (b) => b.toString(16).padStart(2, "0")).join("");
    try {
      s?.setItem("tb_client", id);
    } catch {}
  }
  return id;
}

export function track(type: string, reignId: string, value?: number): void {
  const body = JSON.stringify({ type, reignId, clientId: getClientId(), value, referrer: type === "campaign_view" ? document.referrer : undefined });
  try {
    if (type === "experience_time" && navigator.sendBeacon) {
      navigator.sendBeacon("/api/events", new Blob([body], { type: "application/json" }));
      return;
    }
  } catch {}
  void fetch("/api/events", { method: "POST", headers: { "Content-Type": "application/json" }, body, keepalive: true }).catch(() => {});
}

export interface Prefs {
  sound: boolean;
  motion: "system" | "reduced" | "full";
}

export function loadPrefs(): Prefs {
  try {
    const raw = safeStorage()?.getItem("tb_prefs");
    if (raw) return { sound: false, motion: "system", ...JSON.parse(raw) };
  } catch {}
  return { sound: false, motion: "system" };
}

export function savePrefs(p: Prefs) {
  try {
    safeStorage()?.setItem("tb_prefs", JSON.stringify(p));
  } catch {}
}

export function prefersReducedMotion(p: Prefs): boolean {
  if (p.motion === "reduced") return true;
  if (p.motion === "full") return false;
  return typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}
