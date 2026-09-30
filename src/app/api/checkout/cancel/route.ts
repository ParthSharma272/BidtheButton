import { handle, json, readJson, requireUser } from "@/server/http.ts";
import { cancelCheckout } from "@/server/payments/service.ts";

export const POST = handle(async (req: Request) => {
  const user = await requireUser();
  const b = await readJson<{ paymentId?: string }>(req);
  const p = cancelCheckout(user.id, String(b.paymentId ?? ""));
  return json({ state: p.state });
});
