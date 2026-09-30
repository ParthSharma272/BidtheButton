import { requireAdmin } from "@/server/auth.ts";
import { currentUser, handle, json } from "@/server/http.ts";
import { adminRefund } from "@/server/payments/service.ts";

type Ctx = { params: Promise<{ id: string }> };

export const POST = handle(async (_req: Request, ctx: Ctx) => {
  const admin = requireAdmin(await currentUser());
  const p = await adminRefund(admin.id, (await ctx.params).id);
  return json({ state: p.state });
});
