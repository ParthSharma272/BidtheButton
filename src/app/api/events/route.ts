import { EVENT_TYPES, recordEvent, referrerHost, type EventType } from "@/server/analytics.ts";
import { handle, json, limit, readJson } from "@/server/http.ts";
import { markMetricsDirty } from "@/server/jobs.ts";

export const POST = handle(async (req: Request) => {
  await limit("events", 120, 60_000);
  const b = await readJson<{ type?: string; reignId?: string; clientId?: string; value?: number; referrer?: string }>(req, 2048);
  if (!b.type || !EVENT_TYPES.includes(b.type as EventType) || typeof b.reignId !== "string" || typeof b.clientId !== "string") {
    return json({ recorded: false, reason: "invalid" }, 400);
  }
  const r = recordEvent({
    type: b.type as EventType,
    reignId: b.reignId,
    clientId: b.clientId,
    value: typeof b.value === "number" ? b.value : undefined,
    userAgent: req.headers.get("user-agent"),
    referrer: referrerHost(b.referrer, req.headers.get("host")),
  });
  if (r.recorded) markMetricsDirty();
  return json(r);
});
