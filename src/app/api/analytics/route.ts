import { ownerAnalytics } from "@/server/analytics.ts";
import { handle, json, requireUser } from "@/server/http.ts";

export const dynamic = "force-dynamic";

/** Private: only the signed-in owner's own reigns. */
export const GET = handle(async (_req: Request) => {
  const user = await requireUser();
  return json({ reigns: ownerAnalytics(user.id) });
});
