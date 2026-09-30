import { leave } from "@/server/analytics.ts";
import { handle, json, readJson } from "@/server/http.ts";

// Called with navigator.sendBeacon on pagehide, so the count drops promptly.
export const POST = handle(async (req: Request) => {
  const b = await readJson<{ clientId?: string }>(req, 1024);
  if (typeof b.clientId === "string") leave(b.clientId);
  return json({ ok: true });
});
