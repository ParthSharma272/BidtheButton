import { handle, json, requireUser } from "@/server/http.ts";
import { paymentStatusForBuyer } from "@/server/payments/service.ts";

export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ id: string }> };

/** The browser polls this. It reports server state only — never trusts the client. */
export const GET = handle(async (_req: Request, ctx: Ctx) => {
  const user = await requireUser();
  return json(paymentStatusForBuyer(user.id, (await ctx.params).id));
});
