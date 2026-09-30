/**
 * Platform configuration. Everything pricing-related is expressed in integer
 * minor units (paise) and is configurable through environment variables.
 */

function int(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n)) throw new Error(`${name} must be an integer`);
  return n;
}

function bool(name: string, fallback: boolean): boolean {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  return raw === "1" || raw.toLowerCase() === "true";
}

export const config = {
  currency: "INR" as const,
  currencySymbol: "₹",

  /** Price of the very first ownership when nobody has ever owned the button. */
  firstPricePaise: int("FIRST_PRICE_PAISE", 1000), // ₹10

  /** Minimum increase over the previous purchase, in basis points. 1000 = 10%. */
  minIncreaseBps: int("MIN_INCREASE_BPS", 1000),

  /** Hard floor on the increase, regardless of percentage. */
  minIncreaseAbsolutePaise: int("MIN_INCREASE_ABSOLUTE_PAISE", 100), // ₹1

  /** Platform fee added on top of the purchase amount. 0 by default. */
  feeBps: int("FEE_BPS", 0),

  /** Tax applied to (amount + fee). 1800 = 18% GST. */
  taxBps: int("TAX_BPS", 1800),

  /** How long a takeover quote stays valid before it must be refreshed. */
  quoteTtlMs: int("QUOTE_TTL_SECONDS", 180) * 1000,

  /** A presence heartbeat older than this no longer counts as "watching now". */
  presenceTtlMs: int("PRESENCE_TTL_SECONDS", 45) * 1000,

  /** Client heartbeat interval. */
  heartbeatMs: int("HEARTBEAT_SECONDS", 15) * 1000,

  /** A campaign must be on screen this long before it counts as a view. */
  minViewMs: int("MIN_VIEW_MS", 1000),

  /** One counted view per (client, reign) inside this window. */
  viewDedupeMs: int("VIEW_DEDUPE_SECONDS", 1800) * 1000,

  /** Rapid repeat button presses inside this window collapse into one. */
  pressDedupeMs: int("PRESS_DEDUPE_MS", 2000),

  /** Payment provider driver: "mock" (demo, no money) or "razorpay". */
  paymentProvider: (process.env.PAYMENT_PROVIDER ?? "mock") as "mock" | "razorpay",

  /** Skip the human moderation queue. Development convenience only. */
  autoApprove: bool("AUTO_APPROVE_CAMPAIGNS", false),

  /** Max upload size for owner media. */
  maxUploadBytes: int("MAX_UPLOAD_BYTES", 8 * 1024 * 1024),

  sessionTtlMs: int("SESSION_TTL_DAYS", 30) * 24 * 60 * 60 * 1000,

  /**
   * Optional seasons (section 12D). Disabled by default so ownership follows the
   * core rule: control lasts until someone pays more.
   */
  seasonsEnabled: bool("SEASONS_ENABLED", false),
  seasonMaxHoldMs: int("SEASON_MAX_HOLD_HOURS", 72) * 60 * 60 * 1000,
};

export const isDemoProvider = () => config.paymentProvider === "mock";

/** Self-hosted via next/font (see src/app/layout.tsx); the fallbacks are system stacks. */
export const CURATED_FONTS = [
  { id: "inter", label: "Inter", stack: "var(--font-inter), system-ui, -apple-system, 'Segoe UI', sans-serif" },
  { id: "grotesk", label: "Space Grotesk", stack: "var(--font-grotesk), system-ui, sans-serif" },
  { id: "serif", label: "Editorial Serif", stack: "var(--font-serif), 'Iowan Old Style', Georgia, serif" },
  { id: "mono", label: "Technical Mono", stack: "var(--font-mono), ui-monospace, Menlo, monospace" },
  { id: "display", label: "Poster Display", stack: "var(--font-display), Impact, 'Helvetica Neue', sans-serif" },
  { id: "rounded", label: "Soft Rounded", stack: "var(--font-rounded), system-ui, sans-serif" },
] as const;

export type FontId = (typeof CURATED_FONTS)[number]["id"];

export const fontStack = (id: string): string =>
  CURATED_FONTS.find((f) => f.id === id)?.stack ?? CURATED_FONTS[0].stack;

/** Only these hosts may ever be placed in an iframe. */
export const ALLOWED_EMBED_HOSTS = new Set([
  "youtube.com",
  "www.youtube.com",
  "youtu.be",
  "m.youtube.com",
]);
