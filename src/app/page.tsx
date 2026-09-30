import { getPublicState } from "@/server/public-state.ts";
import { ButtonApp } from "@/components/ButtonApp.tsx";

export const dynamic = "force-dynamic";

export default function Home() {
  // Server-rendered with authoritative state, then kept live over SSE.
  return <ButtonApp initial={getPublicState()} />;
}
