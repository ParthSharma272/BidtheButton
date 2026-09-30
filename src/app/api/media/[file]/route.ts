import { readUpload } from "@/server/uploads.ts";

type Ctx = { params: Promise<{ file: string }> };

export async function GET(_req: Request, ctx: Ctx) {
  const f = readUpload((await ctx.params).file);
  if (!f) return new Response("Not found", { status: 404 });
  return new Response(new Uint8Array(f.buf), {
    headers: {
      "Content-Type": f.mime,
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; sandbox",
      "Cache-Control": "public, max-age=31536000, immutable",
    },
  });
}
