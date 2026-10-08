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
