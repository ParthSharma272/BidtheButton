import { z } from "zod";
import { ALLOWED_EMBED_HOSTS, CURATED_FONTS } from "./config.ts";

/**
 * Owner customization is STRUCTURED DATA ONLY.
 *
 * There is no field anywhere in this schema that accepts HTML, CSS, SVG markup,
 * script, or a style string. Every value is a constrained primitive that the
 * renderer maps onto a fixed set of CSS custom properties. An owner can change
 * how the page looks; an owner can never change what the page executes.
 */

export const TEMPLATES = [
  "floating-products",
  "neon-music",
  "minimal-launch",
  "playful-creator",
  "bold-poster",
  "animated-message",
] as const;
export type TemplateId = (typeof TEMPLATES)[number];

const FONT_IDS = CURATED_FONTS.map((f) => f.id) as [string, ...string[]];

// ------------------------------------------------------------------ primitives

/** Strips control characters, zero-width joiners and bidi overrides. Those are
 *  the usual ingredients of impersonation and layout-spoofing attacks. */
function cleanText(s: string): string {
  return s
    .normalize("NFC")
    // C0/C1 control characters -> space
    .replace(/[\u0000-\u001F\u007F-\u009F]/g, " ")
    // zero-width, bidi overrides, word joiner, BOM -> removed
    .replace(/[\u200B-\u200F\u202A-\u202E\u2060-\u2064\u2066-\u2069\uFEFF]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

const text = (max: number) =>
  z
    .string()
    .max(max * 2)
    .transform(cleanText)
    .pipe(z.string().max(max));

const optionalText = (max: number) =>
  z
    .string()
    .max(max * 2)
    .transform(cleanText)
    .pipe(z.string().max(max))
    .optional()
    .or(z.literal("").transform(() => undefined));

const hexColor = z
  .string()
  .trim()
  .regex(/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/, "Must be a hex colour like #1a2b3c");

const unit = z.number().min(0).max(1);

// ------------------------------------------------------------------ urls

const PRIVATE_HOST =
  /^(localhost|127\.|0\.|10\.|169\.254\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|\[?::1\]?|.*\.local|.*\.internal)/i;

export interface UrlCheck {
  ok: boolean;
  reason?: string;
  normalized?: string;
  host?: string;
}

/**
 * Validates an owner-supplied destination.
 *
 * Rejects non-https schemes (kills `javascript:`, `data:`, `file:`), credentials
 * in the authority, and private/loopback/link-local hosts. The private-host
 * check is what protects any current or future server-side fetch of these URLs
 * from being used for SSRF.
 */
export function checkExternalUrl(raw: string): UrlCheck {
  let u: URL;
  try {
    u = new URL(raw.trim());
  } catch {
    return { ok: false, reason: "Not a valid URL" };
  }
  if (u.protocol !== "https:") return { ok: false, reason: "Only https:// links are allowed" };
  if (u.username || u.password) return { ok: false, reason: "URLs may not contain credentials" };
  if (PRIVATE_HOST.test(u.hostname)) return { ok: false, reason: "Private and local addresses are not allowed" };
  if (!u.hostname.includes(".")) return { ok: false, reason: "Host must be a public domain" };
  u.hash = "";
  return { ok: true, normalized: u.toString(), host: u.hostname.replace(/^www\./, "") };
}

const externalUrl = z.string().superRefine((val, ctx) => {
  const r = checkExternalUrl(val);
  if (!r.ok) ctx.addIssue({ code: z.ZodIssueCode.custom, message: r.reason ?? "Invalid URL" });
});

/** Media may be an uploaded asset on this origin or a public https URL. */
const mediaUrl = z.string().superRefine((val, ctx) => {
  if (val.startsWith("/uploads/") || val.startsWith("/demo/")) {
    if (val.includes("..")) ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Invalid asset path" });
    return;
  }
  const r = checkExternalUrl(val);
  if (!r.ok) ctx.addIssue({ code: z.ZodIssueCode.custom, message: r.reason ?? "Invalid URL" });
});

const optionalMediaUrl = mediaUrl.optional().or(z.literal("").transform(() => undefined));

/** Accepts a YouTube URL in any common shape and returns the bare video id. */
export function parseYouTubeId(raw: string): string | null {
  const direct = raw.trim();
  if (/^[\w-]{11}$/.test(direct)) return direct;
  let u: URL;
  try {
    u = new URL(direct);
  } catch {
    return null;
  }
  if (!ALLOWED_EMBED_HOSTS.has(u.hostname)) return null;
  if (u.hostname === "youtu.be") {
    const id = u.pathname.slice(1);
    return /^[\w-]{11}$/.test(id) ? id : null;
  }
  const v = u.searchParams.get("v");
  if (v && /^[\w-]{11}$/.test(v)) return v;
  const m = u.pathname.match(/^\/(?:embed|shorts|live)\/([\w-]{11})/);
  return m ? m[1] : null;
}

// ------------------------------------------------------------------ theme

export const backgroundSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("solid"), color: hexColor }),
  z.object({
    type: z.literal("gradient"),
    from: hexColor,
    to: hexColor,
    via: hexColor.optional(),
    angle: z.number().int().min(0).max(360).default(160),
  }),
  z.object({
    type: z.literal("image"),
    imageUrl: mediaUrl,
    overlay: unit.default(0.45),
    blurPx: z.number().int().min(0).max(24).default(0),
  }),
  z.object({
    type: z.literal("video"),
    videoUrl: mediaUrl,
    posterUrl: optionalMediaUrl,
    overlay: unit.default(0.5),
    // Background video is always muted and is never a sound source.
    blurPx: z.number().int().min(0).max(24).default(0),
  }),
]);

export const paletteSchema = z.object({
  primary: hexColor,
  accent: hexColor,
  text: hexColor,
  muted: hexColor,
  /** Surface colour used behind owner content blocks. */
  surface: hexColor,
});

export const decorAssetSchema = z.object({
  url: mediaUrl,
  /** Percentage position within the stage. */
  x: z.number().min(-10).max(110),
  y: z.number().min(-10).max(110),
  /** Rendered width as a percentage of the stage's shorter edge. */
  size: z.number().min(2).max(60),
  rotation: z.number().min(-180).max(180).default(0),
  /** Parallax depth. 0 = pinned, 1 = maximum drift. */
  depth: unit.default(0.5),
  opacity: z.number().min(0.05).max(1).default(1),
  alt: optionalText(80),
});

export const ANIMATION_PRESETS = ["none", "float", "orbit", "drift", "pulse", "confetti"] as const;
export const BUTTON_ANIMATIONS = ["none", "pulse", "breathe", "glow", "shimmer"] as const;
export const BUTTON_SHAPES = ["circle", "pill", "squircle"] as const;

// ------------------------------------------------------------------ experience

export const experienceSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("link"),
    url: externalUrl,
    title: text(80),
    description: optionalText(200),
    imageUrl: optionalMediaUrl,
    ctaLabel: text(28),
  }),
  z.object({
    type: z.literal("youtube"),
    videoId: z.string().regex(/^[\w-]{11}$/, "Not a YouTube video id"),
    title: text(80),
    description: optionalText(200),
    ctaLabel: optionalText(28),
    ctaUrl: externalUrl.optional().or(z.literal("").transform(() => undefined)),
  }),
  z.object({
    type: z.literal("video"),
    videoUrl: mediaUrl,
    posterUrl: optionalMediaUrl,
    title: text(80),
    description: optionalText(200),
    ctaLabel: optionalText(28),
    ctaUrl: externalUrl.optional().or(z.literal("").transform(() => undefined)),
  }),
  z.object({
    type: z.literal("image"),
    imageUrl: mediaUrl,
    title: text(80),
    description: optionalText(200),
    ctaLabel: optionalText(28),
    ctaUrl: externalUrl.optional().or(z.literal("").transform(() => undefined)),
  }),
  z.object({
    type: z.literal("message"),
    body: text(240),
    title: optionalText(80),
    ctaLabel: optionalText(28),
    ctaUrl: externalUrl.optional().or(z.literal("").transform(() => undefined)),
  }),
]);

export type Experience = z.infer<typeof experienceSchema>;

// ------------------------------------------------------------------ campaign

export const SOCIAL_PLATFORMS = ["website", "x", "instagram", "youtube", "tiktok", "github", "linkedin"] as const;

export const campaignConfigSchema = z.object({
  template: z.enum(TEMPLATES),
  brand: z.object({
    name: text(40),
    logoUrl: optionalMediaUrl,
  }),
  headline: text(80),
  subhead: optionalText(160),
  theme: z.object({
    font: z.enum(FONT_IDS),
    headlineFont: z.enum(FONT_IDS).optional(),
    palette: paletteSchema,
    background: backgroundSchema,
  }),
  button: z.object({
    label: text(24),
    shape: z.enum(BUTTON_SHAPES),
    color: hexColor,
    textColor: hexColor,
    animation: z.enum(BUTTON_ANIMATIONS),
  }),
  decor: z.object({
    preset: z.enum(ANIMATION_PRESETS),
    /** 0 = static, 1 = full motion. Always overridden by prefers-reduced-motion. */
    intensity: unit,
    assets: z.array(decorAssetSchema).max(8),
  }),
  experience: experienceSchema,
  socials: z
    .array(z.object({ platform: z.enum(SOCIAL_PLATFORMS), url: externalUrl }))
    .max(5)
    .default([]),
});

export type CampaignConfig = z.infer<typeof campaignConfigSchema>;

/**
 * Fields whose change requires re-approval. Purely cosmetic tweaks (a colour, a
 * decor position) may be republished without going back through the queue;
 * anything a visitor could be deceived by must be re-reviewed.
 */
export function isMaterialChange(before: CampaignConfig, after: CampaignConfig): boolean {
  const material = (c: CampaignConfig) =>
    JSON.stringify({
      brand: c.brand.name,
      logo: c.brand.logoUrl,
      headline: c.headline,
      subhead: c.subhead,
      button: c.button.label,
      experience: c.experience,
      socials: c.socials,
      bgMedia:
        c.theme.background.type === "image"
          ? c.theme.background.imageUrl
          : c.theme.background.type === "video"
            ? c.theme.background.videoUrl
            : null,
      decorAssets: c.decor.assets.map((a) => a.url),
    });
  return material(before) !== material(after);
}

/** Domain shown on the CTA so visitors always know where a click leads. */
export function experienceDestination(exp: Experience): { url: string; host: string } | null {
  const url = exp.type === "link" ? exp.url : "ctaUrl" in exp ? exp.ctaUrl : undefined;
  if (!url) return null;
  const c = checkExternalUrl(url);
  return c.ok && c.normalized && c.host ? { url: c.normalized, host: c.host } : null;
}
