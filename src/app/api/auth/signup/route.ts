import { cookies } from "next/headers";
import { z } from "zod";
import { createSession, createUser, SESSION_COOKIE } from "@/server/auth.ts";
import { getDb } from "@/server/db.ts";
import { handle, HttpError, json, limit, readJson } from "@/server/http.ts";

const schema = z.object({
  email: z.string().trim().email().max(200),
  password: z.string().min(8, "Use at least 8 characters").max(200),
  displayName: z
    .string()
    .trim()
    .min(2)
    .max(40)
    .regex(/^[\p{L}\p{N} ._'&-]+$/u, "Letters, numbers, spaces and . _ ' & - only"),
});

export const POST = handle(async (req: Request) => {
  await limit("signup", 10, 60 * 60_000);
  const parsed = schema.safeParse(await readJson(req));
  if (!parsed.success) throw new HttpError(parsed.error.issues[0].message, 422);
  const exists = getDb().prepare("SELECT 1 FROM users WHERE email = ?").get(parsed.data.email.toLowerCase());
  if (exists) throw new HttpError("An account with that email already exists", 409);
  const user = createUser(parsed.data);
  const s = createSession(user.id);
  (await cookies()).set(SESSION_COOKIE, s.id, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", expires: s.expiresAt });
  return json({ user });
});
