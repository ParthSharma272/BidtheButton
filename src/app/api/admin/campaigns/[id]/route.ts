import { requireAdmin } from "@/server/auth.ts";
import { approveCampaign, rejectCampaign, reinstateCampaign, suspendCampaign } from "@/server/campaigns.ts";
import { currentUser, handle, HttpError, json, readJson } from "@/server/http.ts";

type Ctx = { params: Promise<{ id: string }> };

export const POST = handle(async (req: Request, ctx: Ctx) => {
  const admin = requireAdmin(await currentUser());
  const id = (await ctx.params).id;
  const b = await readJson<{ action?: string; note?: string }>(req);
  const note = String(b.note ?? "");
  switch (b.action) {
    case "approve":
      approveCampaign(admin.id, id);
      break;
    case "reject":
      if (!note) throw new HttpError("Give the owner a reason", 422);
      rejectCampaign(admin.id, id, note);
      break;
    case "suspend":
      if (!note) throw new HttpError("Record a reason", 422);
      suspendCampaign(admin.id, id, note);
      break;
    case "reinstate":
      reinstateCampaign(admin.id, id);
      break;
    default:
      throw new HttpError("Unknown action", 400);
  }
  return json({ ok: true });
});
