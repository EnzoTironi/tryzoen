import { query } from "@db/queries";
import { sql } from "drizzle-orm";
import { env } from "@shared/environment/env";

export async function requireRuntimeDatabase() {
  const url = new URL(env.DATABASE_URL);
  if (
    !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) ||
    url.pathname !== "/companion_runtime_test"
  ) {
    throw new Error(
      "Runtime tests require the isolated loopback companion_runtime_test database."
    );
  }
  const rows = await query<{ name: string }>(
    sql`SELECT current_database() AS name`
  );
  if (rows[0]?.name !== "companion_runtime_test")
    throw new Error("Runtime database identity mismatch.");
}
