import { getCampaign, publicCampaignSummary, saveDraft } from "@/server/campaigns.ts";
import { handle, HttpError, json, limit, readJson, requireUser } from "@/server/http.ts";

type Ctx = { params: Promise<{ id: string }> };

export const GET = handle(async (_req: Request, ctx: Ctx) => {
  const user = await requireUser();
  const c = getCampaign((await ctx.params).id);
  if (!c || c.user_id !== user.id) throw new HttpError("Campaign not found", 404);
  return json({ campaign: publicCampaignSummary(c) });
});

export const PUT = handle(async (req: Request, ctx: Ctx) => {
  const user = await requireUser();
  await limit("campaign-save", 120, 60 * 60_000);
  const b = await readJson<{ name?: string; config?: unknown }>(req);
  const c = saveDraft(user.id, (await ctx.params).id, b.name, b.config);
  return json({ campaign: publicCampaignSummary(c) });
});
