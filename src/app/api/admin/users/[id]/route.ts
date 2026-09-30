import { requireAdmin } from "@/server/auth.ts";
import { audit, getDb } from "@/server/db.ts";
import { currentUser, handle, json, readJson } from "@/server/http.ts";
import { publish } from "@/server/bus.ts";

type Ctx = { params: Promise<{ id: string }> };

/** Verification badge. Only an administrator can grant it, after real checks. */
export const POST = handle(async (req: Request, ctx: Ctx) => {
  const admin = requireAdmin(await currentUser());
  const id = (await ctx.params).id;
  const b = await readJson<{ verified?: boolean }>(req);
  getDb().prepare("UPDATE users SET verified = ? WHERE id = ?").run(b.verified ? 1 : 0, id);
  audit("user.verified", "user", id, { verified: !!b.verified }, admin.id);
  publish({ type: "ownership", payload: { reason: "verification" } });
  return json({ ok: true });
});
