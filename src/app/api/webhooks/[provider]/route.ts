import { applyProviderEvent } from "@/server/payments/service.ts";
import { getProvider } from "@/server/payments/providers/index.ts";
import { config } from "@/server/config.ts";

export const runtime = "nodejs";
type Ctx = { params: Promise<{ provider: string }> };

/**
 * Provider webhooks. The raw body is verified against the provider signature
 * before anything is parsed. Returns 2xx for duplicates so the provider stops
 * retrying; returns 5xx on unexpected errors so it retries later.
 */
export async function POST(req: Request, ctx: Ctx) {
  const name = (await ctx.params).provider;
  if (name !== config.paymentProvider) return new Response("Unknown provider", { status: 404 });
  const provider = getProvider(name);
  const raw = await req.text();
  let ev;
  try {
    ev = provider.parseWebhook(raw, req.headers);
  } catch (e) {
    return new Response(`Rejected: ${(e as Error).message}`, { status: 400 });
  }
  try {
    const r = await applyProviderEvent(provider.name, ev);
    return Response.json(r);
  } catch (e) {
    console.error("[webhook]", e);
    return new Response("Retry later", { status: 500 });
  }
}
