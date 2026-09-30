import { requireAdmin } from "@/server/auth.ts";
import { currentUser, handle, HttpError, json, readJson } from "@/server/http.ts";
import { resolveReport } from "@/server/moderation.ts";

type Ctx = { params: Promise<{ id: string }> };

export const POST = handle(async (req: Request, ctx: Ctx) => {
  const admin = requireAdmin(await currentUser());
  const b = await readJson<{ status?: string; resolution?: string }>(req);
  if (b.status !== "actioned" && b.status !== "dismissed") throw new HttpError("Bad status", 400);
  resolveReport(admin.id, (await ctx.params).id, b.status, String(b.resolution ?? ""));
  return json({ ok: true });
});
