import { createCampaign, listCampaignsForUser, publicCampaignSummary } from "@/server/campaigns.ts";
import { handle, json, limit, readJson, requireUser } from "@/server/http.ts";
import { cloneTemplate } from "@/shared/templates.ts";

export const dynamic = "force-dynamic";

export const GET = handle(async (_req: Request) => {
  const user = await requireUser();
  return json({ campaigns: listCampaignsForUser(user.id).map(publicCampaignSummary) });
});

export const POST = handle(async (req: Request) => {
  const user = await requireUser();
  await limit("campaign-create", 30, 60 * 60_000);
  const b = await readJson<{ name?: string; template?: string; config?: unknown }>(req);
  const cfg = b.config ?? cloneTemplate(String(b.template ?? "floating-products"));
  const c = createCampaign(user.id, String(b.name ?? "Untitled campaign"), cfg);
  return json({ campaign: publicCampaignSummary(c) }, 201);
});
