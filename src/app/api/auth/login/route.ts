import { cookies } from "next/headers";
import { authenticate, createSession, SESSION_COOKIE } from "@/server/auth.ts";
import { handle, HttpError, json, limit, readJson } from "@/server/http.ts";

export const POST = handle(async (req: Request) => {
  await limit("login", 20, 15 * 60_000);
  const b = await readJson<{ email?: string; password?: string }>(req);
  const user = authenticate(String(b.email ?? ""), String(b.password ?? ""));
  if (!user) throw new HttpError("Email or password is incorrect", 401);
  const s = createSession(user.id);
  (await cookies()).set(SESSION_COOKIE, s.id, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", expires: s.expiresAt });
  return json({ user });
});
