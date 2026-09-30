import { cookies } from "next/headers";
import { deleteSession, SESSION_COOKIE } from "@/server/auth.ts";
import { handle, json } from "@/server/http.ts";

export const POST = handle(async (_req: Request) => {
  const jar = await cookies();
  const id = jar.get(SESSION_COOKIE)?.value;
  if (id) deleteSession(id);
  jar.delete(SESSION_COOKIE);
  return json({ ok: true });
});
