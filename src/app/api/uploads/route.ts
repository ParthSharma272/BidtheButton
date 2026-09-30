import { handle, HttpError, json, limit, requireUser } from "@/server/http.ts";
import { saveUpload } from "@/server/uploads.ts";
import { config } from "@/server/config.ts";

export const runtime = "nodejs";

export const POST = handle(async (req: Request) => {
  const user = await requireUser();
  await limit("upload", 40, 60 * 60_000);
  const len = Number(req.headers.get("content-length") ?? 0);
  if (len > config.maxUploadBytes + 64 * 1024) throw new HttpError("File too large", 413);
  const form = await req.formData();
  const file = form.get("file");
  if (!(file instanceof File)) throw new HttpError("No file", 400);
  const buf = Buffer.from(await file.arrayBuffer());
  const saved = saveUpload(user.id, buf, form.get("rights") === "yes");
  return json(saved, 201);
});
