import { Studio } from "@/components/Studio.tsx";
import { isDemoProvider } from "@/server/config.ts";

export const metadata = { title: "Studio · THE BUTTON" };
export const dynamic = "force-dynamic";

export default function StudioPage() {
  return <Studio demoMode={isDemoProvider()} />;
}
