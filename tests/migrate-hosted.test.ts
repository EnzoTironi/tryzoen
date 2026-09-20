import { spawnSync } from "node:child_process";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { migrateApplication } from "../server/database/migrations";

vi.mock("../server/database/migrations", () => ({
  migrateApplication: vi.fn<typeof migrateApplication>(),
}));

const originalExitCode = process.exitCode;

beforeEach(() => {
  vi.resetModules();
  vi.mocked(migrateApplication).mockReset();
  vi.mocked(migrateApplication).mockResolvedValue({
    applicationMigrations: 44,
    workflowMigrations: 20,
  });
  for (const name of [
    "DATABASE_URL",
    "DATABASE_URL_UNPOOLED",
    "ZOEN_DATABASE_HOST",
    "POSTGRES_DB",
    "ZOEN_MIGRATION_DATABASE_PASSWORD",
  ])
    vi.stubEnv(name, undefined);
  vi.spyOn(console, "info").mockImplementation(() => undefined);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  process.exitCode = undefined;
});

afterEach(() => {
  process.exitCode = originalExitCode;
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

test("migrates with only dedicated credentials and encodes password and database", async () => {
  vi.stubEnv("ZOEN_DATABASE_HOST", "database.internal");
  vi.stubEnv("POSTGRES_DB", "migration database");
  vi.stubEnv("ZOEN_MIGRATION_DATABASE_PASSWORD", "p@ss:/?#% word");

  await import("../scripts/migrate-hosted");

  expect(migrateApplication).toHaveBeenCalledExactlyOnceWith(
    "postgresql://zoen_migrator:p%40ss%3A%2F%3F%23%25%20word@database.internal:5432/migration%20database"
  );
  expect(process.exitCode).toBeUndefined();
  expect(console.error).not.toHaveBeenCalled();
});

test("an explicit unpooled URL takes precedence without web or dedicated credentials", async () => {
  const url = "postgresql://dedicated:synthetic-password@database.internal/db";
  vi.stubEnv("DATABASE_URL_UNPOOLED", url);
  vi.stubEnv("ZOEN_DATABASE_HOST", "unused.internal");
  vi.stubEnv("ZOEN_MIGRATION_DATABASE_PASSWORD", "unused-password");

  await import("../scripts/migrate-hosted");

  expect(migrateApplication).toHaveBeenCalledExactlyOnceWith(url);
  expect(process.exitCode).toBeUndefined();
});

test.each([
  "ZOEN_DATABASE_HOST",
  "POSTGRES_DB",
  "ZOEN_MIGRATION_DATABASE_PASSWORD",
])(
  "missing %s fails before database access without printing credentials",
  async (missing) => {
    vi.stubEnv("ZOEN_DATABASE_HOST", "database.internal");
    vi.stubEnv("POSTGRES_DB", "migration_database");
    vi.stubEnv("ZOEN_MIGRATION_DATABASE_PASSWORD", "synthetic-secret");
    vi.stubEnv(missing, undefined);

    await import("../scripts/migrate-hosted");

    expect(migrateApplication).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(1);
    expect(console.error).toHaveBeenCalledExactlyOnceWith(
      "Set DATABASE_URL_UNPOOLED or the dedicated migration credentials."
    );
    expect(console.info).not.toHaveBeenCalled();
  }
);

test("an invalid explicit URL fails before database access without printing it", async () => {
  vi.stubEnv(
    "DATABASE_URL_UNPOOLED",
    "https://synthetic-secret@example.com/db"
  );

  await import("../scripts/migrate-hosted");

  expect(migrateApplication).not.toHaveBeenCalled();
  expect(process.exitCode).toBe(1);
  expect(console.error).toHaveBeenCalledExactlyOnceWith(
    "DATABASE_URL_UNPOOLED must be a PostgreSQL URL."
  );
});

test("the real bootstrap import chain does not require the web environment", () => {
  const result = spawnSync(
    process.execPath,
    ["--import", "tsx", "scripts/migrate-hosted.ts"],
    { env: { NODE_ENV: "production" }, encoding: "utf8", timeout: 10_000 }
  );

  expect(result.error).toBeUndefined();
  expect(result.status).toBe(1);
  expect(result.stdout).toBe("");
  expect(result.stderr.trim()).toBe(
    "Set DATABASE_URL_UNPOOLED or the dedicated migration credentials."
  );
});
