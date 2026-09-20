import { z } from "zod";
import { databaseUrlSchema } from "../shared/environment/database-url.ts";
import { withTimeout } from "../server/operations/async.ts";
import { migrateApplication } from "../server/database/migrations.ts";

try {
  // The isolated migration machine has dedicated credentials, not the web environment.
  // oxlint-disable-next-line eslint/no-restricted-properties -- Validate only this bootstrap's credentials below.
  const environment = process.env;
  let url = environment.DATABASE_URL_UNPOOLED;
  if (url && !databaseUrlSchema.safeParse(url).success)
    throw new Error("DATABASE_URL_UNPOOLED must be a PostgreSQL URL.");
  if (!url) {
    const required = z.string().refine((value) => value.trim().length > 0);
    const credentials = z
      .object({
        ZOEN_DATABASE_HOST: required,
        POSTGRES_DB: required,
        ZOEN_MIGRATION_DATABASE_PASSWORD: required,
      })
      .safeParse(environment);
    if (!credentials.success)
      throw new Error(
        "Set DATABASE_URL_UNPOOLED or the dedicated migration credentials."
      );
    const {
      ZOEN_DATABASE_HOST: host,
      POSTGRES_DB: database,
      ZOEN_MIGRATION_DATABASE_PASSWORD: password,
    } = credentials.data;
    url = `postgresql://zoen_migrator:${encodeURIComponent(password)}@${host}:5432/${encodeURIComponent(database)}`;
  }
  const target = url;
  console.info(
    "Database migrations verified",
    await withTimeout(() => migrateApplication(target), 600_000)
  );
} catch (error) {
  console.error(
    error instanceof Error ? error.message : "Database migration failed."
  );
  process.exitCode = 1;
}
