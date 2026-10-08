import { env } from "@shared/environment/env";
import { downloadMastraNote } from "../../../../../server/mastra/pilot";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  if (!env.ZOEN_MASTRA_PILOT_ENABLED)
    return new Response(null, { status: 404 });
  try {
    return await downloadMastraNote(
      request.headers,
      new URL(request.url).searchParams.get("runId") ?? ""
    );
  } catch {
    return new Response(null, {
      status: 403,
      headers: { "Cache-Control": "no-store" },
    });
  }
}
