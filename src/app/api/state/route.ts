import { getPublicState } from "@/server/public-state.ts";
import { json } from "@/server/http.ts";

export const dynamic = "force-dynamic";

export async function GET() {
  return json(getPublicState());
}
