import { env } from "../shared/environment/env.ts";
import { withTimeout } from "../server/operations/async.ts";
import { migrateApplication } from "../server/database/migrations.ts";

try {
  let url = env.DATABASE_URL_UNPOOLED;
  if (!url) {
    const {
      ZOEN_DATABASE_HOST: host,
      POSTGRES_DB: database,
      ZOEN_MIGRATION_DATABASE_PASSWORD: password,
    } = env;
    if (!host || !database || !password)
      throw new Error(
        "Set DATABASE_URL_UNPOOLED or the dedicated migration credentials."
      );
    url = `postgresql://zoen_migrator:${encodeURIComponent(password.reveal())}@${host}:5432/${encodeURIComponent(database)}`;
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
