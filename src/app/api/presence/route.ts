import { heartbeat } from "@/server/analytics.ts";
import { handle, json, limit, readJson } from "@/server/http.ts";
import { startJobs } from "@/server/jobs.ts";

export const POST = handle(async (req: Request) => {
  startJobs();
  await limit("presence", 30, 60_000);
  const b = await readJson<{ clientId?: string; visible?: boolean; reignId?: string | null }>(req, 1024);
  if (typeof b.clientId === "string") heartbeat(b.clientId, b.visible !== false, typeof b.reignId === "string" ? b.reignId : null);
  return json({ ok: true });
});
