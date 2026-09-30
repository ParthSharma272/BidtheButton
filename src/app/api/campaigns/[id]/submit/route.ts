import { publicCampaignSummary, submitCampaign } from "@/server/campaigns.ts";
import { handle, json, requireUser } from "@/server/http.ts";

type Ctx = { params: Promise<{ id: string }> };

export const POST = handle(async (_req: Request, ctx: Ctx) => {
  const user = await requireUser();
  const r = submitCampaign(user.id, (await ctx.params).id);
  return json({ outcome: r.outcome, campaign: publicCampaignSummary(r.campaign) });
});
