import { createReport, REPORT_REASONS, type ReportReason } from "@/server/moderation.ts";
import { currentUser, handle, HttpError, json, limit, readJson } from "@/server/http.ts";

export const POST = handle(async (req: Request) => {
  await limit("report", 10, 60 * 60_000);
  const b = await readJson<{ reignId?: string; reason?: string; detail?: string; clientId?: string }>(req);
  if (!REPORT_REASONS.includes(b.reason as ReportReason)) throw new HttpError("Choose a reason", 422);
  const user = await currentUser();
  try {
    const r = createReport({ reignId: String(b.reignId ?? ""), reason: b.reason as ReportReason, detail: b.detail, userId: user?.id, clientId: typeof b.clientId === "string" ? b.clientId.slice(0, 64) : null });
    return json(r, 201);
  } catch {
    throw new HttpError("Could not file that report", 422);
  }
});
