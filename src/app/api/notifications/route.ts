import { getDb } from "@/server/db.ts";
import { handle, json, requireUser } from "@/server/http.ts";

export const POST = handle(async (_req: Request) => {
  const user = await requireUser();
  getDb().prepare("UPDATE notifications SET read = 1 WHERE user_id = ?").run(user.id);
  return json({ ok: true });
});
