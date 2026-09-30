import { subscribe, type BusMessage } from "@/server/bus.ts";
import { getPublicState } from "@/server/public-state.ts";
import { startJobs } from "@/server/jobs.ts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Server-Sent Events. Ownership messages carry the full public state so every
 * client converges on server truth; the client also refetches /api/state on
 * every (re)connect.
 */
export async function GET(req: Request) {
  startJobs();
  const enc = new TextEncoder();
  let unsubscribe = () => {};
  let ping: ReturnType<typeof setInterval> | undefined;

  const stream = new ReadableStream({
    start(controller) {
      const send = (event: string, data: unknown) => {
        try {
          controller.enqueue(enc.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
        } catch {
          cleanup();
        }
      };
      const cleanup = () => {
        unsubscribe();
        if (ping) clearInterval(ping);
      };
      controller.enqueue(enc.encode("retry: 3000\n\n"));
      send("state", getPublicState());
      unsubscribe = subscribe((msg: BusMessage) => {
        if (msg.type === "ownership") send("state", getPublicState());
        else send(msg.type, msg.payload);
      });
      ping = setInterval(() => send("ping", { t: Date.now() }), 20_000);
      req.signal.addEventListener("abort", () => {
        cleanup();
        try {
          controller.close();
        } catch {}
      });
    },
    cancel() {
      unsubscribe();
      if (ping) clearInterval(ping);
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-store, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
