import { PostgresStore } from "@mastra/pg";
import { Client } from "pg";
import { env } from "@shared/environment/env";

if (!env.DATABASE_URL_UNPOOLED)
  throw new Error("Configure DATABASE_URL_UNPOOLED with the migration role.");
const storage = new PostgresStore({
  id: "zoen-mastra-pilot-setup",
  connectionString: env.DATABASE_URL_UNPOOLED,
  schemaName: "mastra_pilot",
});
const client = new Client({ connectionString: env.DATABASE_URL_UNPOOLED });
try {
  await storage.init();
  await client.connect();
  // Native writes share the lifetime of their authenticated product owners.
  // FK checks also fence a model/checkpoint write arriving after deletion.
  for (const [table, column, owner, ownerColumn] of [
    ["mastra_threads", "id", "mastra_pilot_conversation", "id"],
    ["mastra_threads", "resourceId", "workspaces", "id"],
    ["mastra_messages", "thread_id", "mastra_pilot_conversation", "id"],
    ["mastra_messages", "resourceId", "workspaces", "id"],
    ["mastra_resources", "id", "workspaces", "id"],
    ["mastra_workflow_snapshot", "run_id", "mastra_pilot_run", "id"],
    ["mastra_workflow_snapshot", "resourceId", "workspaces", "id"],
    [
      "mastra_observational_memory",
      "threadId",
      "mastra_pilot_conversation",
      "id",
    ],
    ["mastra_observational_memory", "resourceId", "workspaces", "id"],
  ] as const) {
    const constraint = `zoen_${table}_${column}_owner_fk`;
    await client.query(`DO $owner$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_constraint
          WHERE conrelid='mastra_pilot.${table}'::regclass AND conname='${constraint}') THEN
          ALTER TABLE mastra_pilot."${table}" ADD CONSTRAINT "${constraint}"
            FOREIGN KEY ("${column}") REFERENCES public."${owner}"("${ownerColumn}") ON DELETE CASCADE;
        END IF;
      END $owner$;`);
  }
  await client.query(`GRANT USAGE ON SCHEMA mastra_pilot TO zoen_app;
    GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA mastra_pilot TO zoen_app;
    GRANT USAGE,SELECT ON ALL SEQUENCES IN SCHEMA mastra_pilot TO zoen_app;
    ALTER DEFAULT PRIVILEGES IN SCHEMA mastra_pilot GRANT SELECT,INSERT,UPDATE,DELETE ON TABLES TO zoen_app;
    ALTER DEFAULT PRIVILEGES IN SCHEMA mastra_pilot GRANT USAGE,SELECT ON SEQUENCES TO zoen_app;`);
  console.log("Mastra pilot PostgreSQL schema ready.");
} finally {
  await client.end();
  await storage.close();
}
