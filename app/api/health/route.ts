import { query } from "@db/queries";
import { sql } from "drizzle-orm";
import { withSignal, withTimeout } from "../../../server/operations/async";
import { TimeoutError } from "../../../server/operations/async";
import { SqlError } from "../../../db/queries";

/** Readiness includes the database; Eve's own endpoint remains the runtime probe. */
export async function GET(request: Request) {
  return withSignal(request.signal, async () => {
    try {
      return await withTimeout(async () => {
        await query(sql`SELECT 1`);
        return Response.json(
          { status: "ready" },
          { headers: { "cache-control": "no-store" } }
        );
      }, 2000);
    } catch (error) {
      if (error instanceof SqlError || error instanceof TimeoutError)
        return Response.json(
          { status: "unavailable" },
          { status: 503, headers: { "cache-control": "no-store" } }
        );
      throw error;
    }
  });
}
