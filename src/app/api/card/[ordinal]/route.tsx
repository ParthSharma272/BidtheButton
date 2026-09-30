import { ImageResponse } from "next/og";
import { archivedReign } from "@/server/public-state.ts";
import { formatPaise } from "@/server/pricing.ts";
import { formatDuration } from "@/shared/format.ts";

export const runtime = "nodejs";
type Ctx = { params: Promise<{ ordinal: string }> };

/**
 * Shareable ownership card. Every figure comes from recorded data; if a metric
 * is zero it is shown as zero, never rounded up or estimated.
 */
export async function GET(req: Request, ctx: Ctx) {
  const ordinal = Number((await ctx.params).ordinal);
  const r = Number.isInteger(ordinal) ? archivedReign(ordinal) : null;
  if (!r) return new Response("Not found", { status: 404 });
  const kind = new URL(req.url).searchParams.get("kind") === "announce" ? "announce" : "owned";
  const cfg = r.config;
  const primary = cfg?.theme.palette.primary ?? "#333333";
  const brand = r.suspended ? "Suspended campaign" : (cfg?.brand.name ?? r.owner.name);

  const title =
    kind === "announce" ? `${brand} now owns THE BUTTON` : r.ongoing ? `${brand} owns THE BUTTON` : `${brand} owned THE BUTTON`;
  const rows = [
    `Takeover #${r.ordinal}`,
    // The bundled OG font has no ₹ glyph.
    `Purchased for INR ${formatPaise(r.amountPaise, { symbol: false })}`,
    `${r.ongoing ? "Holding for" : "Held for"} ${formatDuration(r.durationMs)}`,
    `Seen ${r.counters.views.toLocaleString("en-IN")} times`,
  ];

  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", justifyContent: "space-between", padding: 64, background: `linear-gradient(135deg, ${primary}, #0b0b0f)`, color: "white", fontFamily: "sans-serif" }}>
        <div style={{ display: "flex", fontSize: 28, letterSpacing: 6, opacity: 0.85 }}>THE BUTTON{r.isDemo ? "  ·  DEMO" : ""}</div>
        <div style={{ display: "flex", flexDirection: "column" }}>
          <div style={{ fontSize: 72, fontWeight: 800, lineHeight: 1.05, maxWidth: 1000 }}>{title}</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 28, marginTop: 36, fontSize: 32, opacity: 0.92 }}>
            {rows.map((t) => (
              <div key={t} style={{ display: "flex" }}>{t}</div>
            ))}
          </div>
        </div>
        <div style={{ display: "flex", fontSize: 24, opacity: 0.7 }}>{r.ongoing ? "Live now" : "Historical record"} · One button. One owner. The internet is watching.</div>
      </div>
    ),
    { width: 1200, height: 630 },
  );
}
