import { handle, json, limit, readJson, requireUser } from "@/server/http.ts";
import { startCheckout } from "@/server/payments/service.ts";

export const POST = handle(async (req: Request) => {
  const user = await requireUser();
  await limit("checkout", 30, 60 * 60_000);
  const b = await readJson<{ quoteId?: string; consentedTotalPaise?: number; acceptedTerms?: boolean }>(req);
  const r = await startCheckout(user.id, String(b.quoteId ?? ""), Number(b.consentedTotalPaise), b.acceptedTerms === true);
  return json({ paymentId: r.payment.id, state: r.payment.state, provider: r.provider, isTestMode: r.isTestMode, clientData: r.clientData, totalPaise: r.payment.total_paise });
});
