import { query } from "@db/queries";
import { sql } from "drizzle-orm";
import { execFileSync } from "node:child_process";
import { mkdtempDisposable, open } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { expect, test } from "vitest";
import {
  requestAccountDeletion,
  applyAccountDeletionTombstones,
} from "../../server/accounts/deletion";
import { workspaceFixture } from "./workspace-fixture";
import { installErasureJournalFixture } from "./erasure-journal-fixture";
import { ErasureJournal } from "../../server/accounts/erasure-journal";

installErasureJournalFixture();
const container = process.env.ZOEN_RESTORE_TEST_CONTAINER ?? "";
test("a backup predating native identity enrollment recovers exact handles and room departures from the independent journal", async () => {
  if (!container) throw new Error("The isolated restore container is required");
  await using resources = new AsyncDisposableStack();
  const fixture = resources.use(await workspaceFixture());
  const { actor, guest, guestPersonal } = fixture;
  // Cleanup is limited to this fixture's own request/ledger, including after restore.
  resources.defer(async () => {
    await query(
      sql`DELETE FROM account_deletion_requests WHERE user_id=${guest.userId}`
    );
  });
  const bindingId = randomUUID();
  const matrixId = `@restore-${randomUUID()}:zoen-eve.test`;
  const roomId = `!restore-${randomUUID()}:zoen-eve.test`;
  await query(sql`INSERT INTO workspace_group_bindings(
    id,workspace_id,channel,installation_id,conversation_id,label,created_by
  ) VALUES (${bindingId},${guest.workspaceId},'matrix','zoen-eve.test',${roomId},
    'Synthetic erasure recovery',${actor.userId})`);
  await using directory = await mkdtempDisposable(
    join(tmpdir(), "zoen-restore-")
  );
  const path = join(directory.path, "database.dump");
  await using backup = await open(path, "wx", 0o600);
  execFileSync(
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
      stdio: ["ignore", backup.fd, "pipe"],
    }
  );
  // Both native identity and participation were introduced AFTER the SQL backup.
  // A userId-only tombstone could never recover either exact native handle.
  await query(sql`INSERT INTO matrix_identities(user_id,matrix_id)
    VALUES (${guest.userId},${matrixId})`);
  await query(sql`INSERT INTO matrix_room_members(binding_id,user_id,state,native_pending)
    VALUES (${bindingId},${guest.userId},'joined',false)`);
  const deleted = await requestAccountDeletion(guest);
  expect(deleted.pending).toContain("matrix");
  const records: Parameters<typeof ErasureJournal.append>[0][] = [];
  for await (const record of ErasureJournal.read(guest.userId))
    records.push(record);
  expect(records).toEqual([
    expect.objectContaining({
      userId: guest.userId,
      matrixIds: [matrixId],
      departures: [expect.objectContaining({ bindingId, matrixId, roomId })],
    }),
  ]);
  expect(
    await query(
      sql`SELECT 1 FROM public.user WHERE id = ${guest.userId.slice("better-auth:".length)}`
    )
  ).toHaveLength(0);
  await using restoreInput = await open(path, "r");
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
      stdio: [restoreInput.fd, "ignore", "pipe"],
    }
  );
  expect(
    await query(
      sql`SELECT 1 FROM public.user WHERE id = ${guest.userId.slice("better-auth:".length)}`
    )
  ).toHaveLength(1);
  expect(
    await query(
      sql`SELECT 1 FROM matrix_identities WHERE user_id=${guest.userId}`
    )
  ).toHaveLength(0);
  expect(
    await query(
      sql`SELECT 1 FROM matrix_room_members WHERE binding_id=${bindingId}`
    )
  ).toHaveLength(0);
  expect(
    await query(
      sql`SELECT 1 FROM matrix_erasure_departures WHERE binding_id=${bindingId}`
    )
  ).toHaveLength(0);
  expect(
    await query(
      sql`SELECT 1 FROM account_deletion_requests WHERE user_id=${guest.userId}`
    )
  ).toHaveLength(0);
  await applyAccountDeletionTombstones();
  expect(
    await query(sql`SELECT matrix_id,owner_user_id FROM matrix_erasure_departures
    WHERE binding_id=${bindingId}`)
  ).toEqual([{ matrix_id: matrixId, owner_user_id: guest.userId }]);
  expect(
    await query(sql`SELECT l.matrix_ids,l.status FROM account_deletion_ledger l
    JOIN account_deletion_requests r ON r.id=l.request_id
    WHERE r.user_id=${guest.userId} AND l.surface='matrix'`)
  ).toEqual([{ matrix_ids: [matrixId], status: "pending_external" }]);
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
    await query(sql`SELECT matrix_id,owner_user_id FROM matrix_erasure_departures
    WHERE binding_id=${bindingId}`)
  ).toEqual([{ matrix_id: matrixId, owner_user_id: guest.userId }]);
  expect(
    await query(
      sql`SELECT 1 FROM public.user WHERE id = ${guest.userId.slice("better-auth:".length)}`
    )
  ).toHaveLength(0);
}, 60_000);
