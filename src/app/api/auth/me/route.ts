import { getDb } from "@/server/db.ts";
import { currentUser, json } from "@/server/http.ts";

export const dynamic = "force-dynamic";

export async function GET() {
  const user = await currentUser();
  if (!user) return json({ user: null });
  const notifications = getDb()
    .prepare("SELECT id, title, body, read, created_at FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT 20")
    .all(user.id);
  return json({ user, notifications });
}
