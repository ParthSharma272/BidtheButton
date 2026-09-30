import { requireAdmin } from "@/server/auth.ts";
import { currentUser, handle, json } from "@/server/http.ts";
import { moderationQueue } from "@/server/moderation.ts";

export const dynamic = "force-dynamic";

export const GET = handle(async (_req: Request) => {
  requireAdmin(await currentUser());
  return json(moderationQueue());
});
