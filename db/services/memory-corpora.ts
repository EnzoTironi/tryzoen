import { sql } from "drizzle-orm";
import { z } from "zod";
import { query } from "@db/queries";

const columns = {
  "learned-memory": sql`learned_memory_initialized`,
  "ai-memory": sql`session_memory_initialized`,
};

export type MemoryCorpus = keyof typeof columns;

/** The caller holds the live owner's namespace lock for the entire file operation. */
export async function memoryCorpusInitialized(
  namespace: string,
  corpus: MemoryCorpus
) {
  const rows = await query(sql`SELECT ${columns[corpus]} AS initialized
    FROM workspace_memory_namespace WHERE namespace_id = ${z.uuid().parse(namespace)} FOR UPDATE`);
  return z.object({ initialized: z.boolean() }).parse(rows[0]).initialized;
}

/** Commit with the successful operation, never reset this receipt when files disappear. */
export async function acceptMemoryCorpus(
  namespace: string,
  corpus: MemoryCorpus
) {
  await query(sql`UPDATE workspace_memory_namespace SET ${columns[corpus]} = true
    WHERE namespace_id = ${z.uuid().parse(namespace)} AND NOT ${columns[corpus]}`);
}
