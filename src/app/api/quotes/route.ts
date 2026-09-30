import { handle, HttpError, json, limit, readJson, requireUser } from "@/server/http.ts";
import { createQuote } from "@/server/payments/service.ts";
import { parseRupeesToPaise } from "@/server/pricing.ts";

export const POST = handle(async (req: Request) => {
  const user = await requireUser();
  await limit("quote", 60, 60 * 60_000);
  const b = await readJson<{ campaignId?: string; amount?: string | number }>(req);
  const paise = parseRupeesToPaise(String(b.amount ?? ""));
  if (paise === null) throw new HttpError("Enter a valid amount in rupees", 422);
  const { quote, breakdown } = createQuote(user.id, String(b.campaignId ?? ""), paise);
  return json({ quote: { id: quote.id, expiresAt: quote.expires_at, ownershipVersion: quote.ownership_version, minPaise: quote.min_amount_paise }, breakdown });
});
