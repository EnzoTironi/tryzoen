import { query } from "@db/queries";
import { sql } from "drizzle-orm";
import { execFileSync } from "node:child_process";
import { expect, test } from "vitest";
import {
  requestAccountDeletion,
  applyAccountDeletionTombstones,
} from "../../server/accounts/deletion";
import { ErasureJournal } from "../../server/accounts/erasure-journal";
import { workspaceFixture } from "./workspace-fixture";
import { installErasureJournalFixture } from "./erasure-journal-fixture";

installErasureJournalFixture();
const container = process.env.ZOEN_RESTORE_TEST_CONTAINER ?? "";
test("a full pre-deletion Postgres backup cannot rewind the independent erasure journal", async () => {
  if (!container) throw new Error("The isolated restore container is required");
  await using fixture = await workspaceFixture();
  const { guest, guestPersonal } = fixture;
  const backup = execFileSync(
    "docker",
    [
      "exec",
      container,
      "pg_dump",
      "-U",
      "postgres",
      "-d",
      "companion_runtime_test",
      "-Fc",
    ],
    {
      maxBuffer: 64 * 1024 * 1024,
    }
  );
  await requestAccountDeletion(guest);
  expect(
    await query(
      sql`SELECT 1 FROM public.user WHERE id = ${guest.userId.slice("better-auth:".length)}`
    )
  ).toHaveLength(0);
  await ErasureJournal.append(guest.userId);
  execFileSync(
    "docker",
    [
      "exec",
      "-i",
      container,
      "pg_restore",
      "--clean",
      "--if-exists",
      "--exit-on-error",
      "-U",
      "postgres",
      "-d",
      "companion_runtime_test",
    ],
    {
      input: backup,
      maxBuffer: 64 * 1024 * 1024,
    }
  );
  expect(
    await query(
      sql`SELECT 1 FROM public.user WHERE id = ${guest.userId.slice("better-auth:".length)}`
    )
  ).toHaveLength(1);
  await applyAccountDeletionTombstones();
  const user = await query(
    sql`SELECT 1 FROM public.user WHERE id = ${guest.userId.slice("better-auth:".length)}`
  );
  const workspace = await query(
    sql`SELECT 1 FROM workspaces WHERE id = ${guestPersonal.workspaceId}`
  );
  expect({
    users: user.length,
    workspaces: workspace.length,
  }).toEqual({
    users: 0,
    workspaces: 0,
  });
  await applyAccountDeletionTombstones();
  expect(
    await query(
      sql`SELECT 1 FROM public.user WHERE id = ${guest.userId.slice("better-auth:".length)}`
    )
  ).toHaveLength(0);
}, 60_000);
