import { query, transaction, TransactionBoundaryError } from "@db/queries";
import type { accountDeletionLedger } from "@db/schema/account-deletion";
import type { matrixErasureDepartures } from "@db/schema/matrix";
import type { workspaceGroupBindings } from "@db/schema/workspace-agents";
import type { workspaces } from "@db/schema/workspaces";
import { Secret } from "@shared/environment/secret";
import { sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { beforeEach, expect, test, vi } from "vitest";
import type * as Environment from "@shared/environment";
import {
  applyAccountDeletionTombstones,
  requestAccountDeletion,
} from "../../server/accounts/deletion";
import { ErasureJournal } from "../../server/accounts/erasure-journal";
import { reconcileMatrixErasures } from "../../server/matrix/erasure-reconcile";
import { captureMatrixErasureDepartures } from "../../server/matrix/erasure";
import { accountDeletionProvidersFixture } from "./account-deletion-providers-fixture";
import { installErasureJournalFixture } from "./erasure-journal-fixture";
import { workspaceFixture } from "./workspace-fixture";

vi.mock("@shared/environment", async (original) => {
  const actual = await original<typeof Environment>();
  return {
    ...actual,
    env: {
      ...actual.env,
      ZOEN_MATRIX_URL: "http://127.0.0.1:14352",
      ZOEN_MATRIX_SERVER_NAME: "zoen.test",
      ZOEN_MATRIX_AS_TOKEN: new Secret(
        "synthetic-deletion-matrix-appservice-32bx"
      ),
      ZOEN_MATRIX_HS_TOKEN: new Secret(
        "synthetic-deletion-matrix-homeserver-32bxx"
      ),
      ZOEN_VAULTWARDEN_URL: "http://127.0.0.1:14352",
      ZOEN_VAULTWARDEN_CLIENT_SECRET: new Secret(
        "synthetic-deletion-vault-client-secret-32"
      ),
      ZOEN_WHATSAPP_BRIDGE_URL: "http://127.0.0.1:14352",
      ZOEN_WHATSAPP_PROVISIONING_SECRET: new Secret(
        "synthetic-deletion-whatsapp-provision-32b"
      ),
      ZOEN_WHATSAPP_AS_TOKEN: new Secret(
        "synthetic-deletion-whatsapp-appservice-32bxx"
      ),
    },
  };
});

installErasureJournalFixture();

beforeEach(async () => {
  // The bounded global drainer requires its own isolated, clean obligation frontier.
  const pending = await query(sql`SELECT 1 FROM account_deletion_ledger
    WHERE surface='matrix' AND status='pending_external' AND cardinality(matrix_ids)>0
    UNION ALL SELECT 1 FROM matrix_erasure_departures LIMIT 1`);
  if (pending.length)
    throw new Error(
      "Recovery tests require a clean isolated Matrix erasure frontier."
    );
});

async function recoveryFixture() {
  const resources = new AsyncDisposableStack();
  try {
    const workspace = resources.use(await workspaceFixture());
    resources.defer(async () => {
      await query(
        sql`DELETE FROM account_deletion_requests WHERE user_id IN (${workspace.actor.userId},${workspace.guest.userId})`
      );
      await query(
        sql`DELETE FROM matrix_identities WHERE user_id IN (${workspace.actor.userId},${workspace.guest.userId})`
      );
    });
    const providers = await accountDeletionProvidersFixture();
    resources.defer(() => providers.close());
    return {
      ...workspace,
      providers,
      [Symbol.asyncDispose]: () => resources.disposeAsync(),
    };
  } catch (error) {
    await resources.disposeAsync();
    throw error;
  }
}

async function matrixLedger(userId: string) {
  const rows = await query<
    Pick<typeof accountDeletionLedger.$inferSelect, "matrixIds" | "status">
  >(sql`SELECT l.status,l.matrix_ids AS "matrixIds" FROM account_deletion_ledger l
    JOIN account_deletion_requests r ON r.id=l.request_id
    WHERE r.user_id=${userId} AND l.surface='matrix'`);
  expect(rows).toHaveLength(1);
  const row = rows[0];
  if (!row) throw new Error("Synthetic Matrix erasure ledger is missing.");
  return { ...row, matrixIds: row.matrixIds.toSorted() };
}

async function departuresFor(userId: string) {
  return query<
    Pick<
      typeof matrixErasureDepartures.$inferSelect,
      "bindingId" | "matrixId" | "ownerUserId"
    >
  >(sql`SELECT binding_id AS "bindingId",matrix_id AS "matrixId",owner_user_id AS "ownerUserId"
    FROM matrix_erasure_departures WHERE owner_user_id=${userId} ORDER BY binding_id,matrix_id`);
}

async function journalFor(userId: string) {
  const records: Parameters<typeof ErasureJournal.append>[0][] = [];
  for await (const record of ErasureJournal.read(userId)) records.push(record);
  return records;
}

async function createDeparture(
  workspace: Awaited<ReturnType<typeof workspaceFixture>>,
  matrixId: string
) {
  const [row] = await query<
    Pick<typeof workspaces.$inferSelect, "organizationId">
  >(
    sql`SELECT organization_id AS "organizationId" FROM workspaces WHERE id=${workspace.guest.workspaceId}`
  );
  if (!row?.organizationId)
    throw new Error("Synthetic company organization is missing.");
  const bindingId = randomUUID();
  const roomId = `!erasure-${randomUUID()}:zoen.test`;
  await query(sql`INSERT INTO workspace_group_bindings(
    id,workspace_id,channel,installation_id,conversation_id,label,created_by
  ) VALUES (${bindingId},${workspace.guest.workspaceId},'matrix','zoen.test',${roomId},
    'Synthetic account erasure',${workspace.actor.userId})`);
  return {
    bindingId,
    matrixId,
    roomId,
    installationId: "zoen.test",
    workspaceId: workspace.guest.workspaceId,
    organizationId: row.organizationId,
  };
}

async function bindingEpoch(bindingId: string) {
  const [row] = await query<
    Pick<typeof workspaceGroupBindings.$inferSelect, "epoch">
  >(sql`SELECT epoch FROM workspace_group_bindings WHERE id=${bindingId}`);
  if (!row) throw new Error("Synthetic Matrix binding is missing.");
  return row.epoch;
}

const drain = () => reconcileMatrixErasures(Date.now() + 30_000, 10);

test("a no-room exact identity survives deletion and SQL replay until top-level reconciliation", async () => {
  await using fixture = await recoveryFixture();
  const { guest, providers } = fixture;
  const matrixId = `@erasure-${randomUUID()}:zoen.test`;
  providers.setMatrixFailure(matrixId, true);
  await query(sql`INSERT INTO matrix_identities(user_id,matrix_id)
    VALUES (${guest.userId},${matrixId})`);

  const deleted = await requestAccountDeletion(guest);
  expect(deleted.pending).toContain("matrix");
  expect(providers.matrixAttempts).toEqual([]);
  expect(providers.deactivated).toEqual([]);
  expect(
    await query(
      sql`SELECT 1 FROM matrix_identities WHERE user_id=${guest.userId}`
    )
  ).toHaveLength(0);
  expect(await departuresFor(guest.userId)).toEqual([]);
  expect(await journalFor(guest.userId)).toEqual([
    expect.objectContaining({
      userId: guest.userId,
      matrixIds: [matrixId],
      departures: [],
    }),
  ]);
  expect(await matrixLedger(guest.userId)).toEqual({
    status: "pending_external",
    matrixIds: [matrixId],
  });

  await applyAccountDeletionTombstones();
  expect(providers.matrixAttempts).toEqual([]);
  // The independent journal also recovers a deletion ledger rewound by restoration.
  await query(
    sql`DELETE FROM account_deletion_requests WHERE user_id=${guest.userId}`
  );
  await applyAccountDeletionTombstones();
  expect(providers.matrixAttempts).toEqual([]);
  expect(await matrixLedger(guest.userId)).toEqual({
    status: "pending_external",
    matrixIds: [matrixId],
  });

  await drain();
  expect(providers.matrixAttempts).toEqual([matrixId]);
  expect(providers.deactivated).toEqual([]);
  expect(await matrixLedger(guest.userId)).toEqual({
    status: "pending_external",
    matrixIds: [matrixId],
  });
  providers.setMatrixFailure(matrixId, false);
  await drain();
  expect(providers.matrixAttempts).toEqual([matrixId, matrixId]);
  expect(providers.deactivated).toEqual([matrixId]);
  expect(await matrixLedger(guest.userId)).toEqual({
    status: "erased",
    matrixIds: [],
  });
});

test.each(["A first", "A+B first"] as const)(
  "immutable A and A+B captures replay as a union (%s)",
  async (order) => {
    await using fixture = await recoveryFixture();
    const { guest, providers } = fixture;
    const matrixA = `@erasure-a-${randomUUID()}:zoen.test`;
    const matrixB = `@erasure-b-${randomUUID()}:zoen.test`;
    const departureA = await createDeparture(fixture, matrixA);
    const departureB = { ...departureA, matrixId: matrixB };
    const recordA = {
      userId: guest.userId,
      matrixIds: [matrixA],
      departures: [departureA],
    };
    const recordAB = {
      userId: guest.userId,
      matrixIds: [matrixA, matrixB],
      departures: [departureA, departureB],
    };
    for (const record of order === "A first"
      ? [recordA, recordAB]
      : [recordAB, recordA])
      await ErasureJournal.append(record);
    await ErasureJournal.append(recordA);
    expect(await journalFor(guest.userId)).toHaveLength(2);

    await applyAccountDeletionTombstones();
    expect(providers.matrixAttempts).toEqual([]);
    expect(providers.deactivated).toEqual([]);
    expect(await matrixLedger(guest.userId)).toEqual({
      status: "pending_external",
      matrixIds: [matrixA, matrixB].toSorted(),
    });
    const expected = [matrixA, matrixB].toSorted().map((matrixId) => ({
      bindingId: departureA.bindingId,
      matrixId,
      ownerUserId: guest.userId,
    }));
    expect(await departuresFor(guest.userId)).toEqual(expected);
    const epoch = await bindingEpoch(departureA.bindingId);
    await applyAccountDeletionTombstones();
    expect(await departuresFor(guest.userId)).toEqual(expected);
    expect(await bindingEpoch(departureA.bindingId)).toBe(epoch);
    expect(providers.matrixAttempts).toEqual([]);
  }
);

test("successful A acknowledgement preserves B captured during top-level provider work", async () => {
  await using fixture = await recoveryFixture();
  const { guest, providers } = fixture;
  const matrixA = `@erasure-a-${randomUUID()}:zoen.test`;
  const matrixB = `@erasure-b-${randomUUID()}:zoen.test`;
  await ErasureJournal.append({
    userId: guest.userId,
    matrixIds: [matrixA],
    departures: [],
  });
  await applyAccountDeletionTombstones();
  expect(providers.matrixAttempts).toEqual([]);
  providers.setMatrixFailure(matrixB, true);
  const hold = providers.holdNextMatrixDeactivation(matrixA);
  const running = drain();
  try {
    await Promise.race([
      hold.entered,
      running.then(() => {
        throw new Error("Synthetic drain completed before the held request.");
      }),
    ]);
    expect(providers.matrixAttempts).toEqual([matrixA]);
    await ErasureJournal.append({
      userId: guest.userId,
      matrixIds: [matrixA, matrixB],
      departures: [],
    });
    await applyAccountDeletionTombstones();
    expect(providers.matrixAttempts).toEqual([matrixA]);
    expect(await matrixLedger(guest.userId)).toEqual({
      status: "pending_external",
      matrixIds: [matrixA, matrixB].toSorted(),
    });
  } finally {
    hold.release();
    await running;
  }
  expect(await matrixLedger(guest.userId)).toEqual({
    status: "pending_external",
    matrixIds: [matrixB],
  });
  await drain();
  expect(providers.matrixAttempts).toContain(matrixB);
  expect(providers.deactivated).toEqual([matrixA]);
  expect(await matrixLedger(guest.userId)).toEqual({
    status: "pending_external",
    matrixIds: [matrixB],
  });
  providers.setMatrixFailure(matrixB, false);
  await drain();
  expect(providers.deactivated).toEqual([matrixA, matrixB]);
  expect(await matrixLedger(guest.userId)).toEqual({
    status: "erased",
    matrixIds: [],
  });
});

test("the public transaction wrapper denies nested erasure reconciliation before provider I/O", async () => {
  await using fixture = await recoveryFixture();
  const { guest, providers } = fixture;
  const matrixId = `@erasure-${randomUUID()}:zoen.test`;
  await ErasureJournal.append({
    userId: guest.userId,
    matrixIds: [matrixId],
    departures: [],
  });
  await applyAccountDeletionTombstones();

  await transaction(async () => {
    await expect(drain()).rejects.toBeInstanceOf(TransactionBoundaryError);
    expect(providers.matrixAttempts).toEqual([]);
    await transaction(async () => {
      await expect(drain()).rejects.toBeInstanceOf(TransactionBoundaryError);
      expect(providers.matrixAttempts).toEqual([]);
    });
  });
  expect(await matrixLedger(guest.userId)).toEqual({
    status: "pending_external",
    matrixIds: [matrixId],
  });
  await drain();
  expect(providers.matrixAttempts).toEqual([matrixId]);
  expect(await matrixLedger(guest.userId)).toEqual({
    status: "erased",
    matrixIds: [],
  });
});

test("outer rollback reverts SQL capture while preserving exact immutable journal intent", async () => {
  await using fixture = await recoveryFixture();
  const { guest, providers } = fixture;
  const matrixId = `@erasure-${randomUUID()}:zoen.test`;
  const departure = await createDeparture(fixture, matrixId);
  const epoch = await bindingEpoch(departure.bindingId);
  await query(sql`INSERT INTO matrix_identities(user_id,matrix_id)
    VALUES (${guest.userId},${matrixId})`);
  await query(sql`INSERT INTO matrix_room_members(binding_id,user_id,state)
    VALUES (${departure.bindingId},${guest.userId},'joined')`);
  const rollback = new Error("Synthetic outer account erasure rollback.");

  await expect(
    transaction(async () => {
      // The public deletion boundary rejects nested savepoints before preparing
      // an intent or dispatching a provider wipe.
      await expect(requestAccountDeletion(guest)).rejects.toMatchObject({
        reason: "unavailable",
      });
      expect(await journalFor(guest.userId)).toEqual([]);
      const captured = await captureMatrixErasureDepartures(guest.userId);
      await ErasureJournal.append({
        userId: guest.userId,
        matrixIds: [matrixId],
        departures: captured,
      });
      expect(await departuresFor(guest.userId)).toHaveLength(1);
      expect(providers.matrixAttempts).toEqual([]);
      throw rollback;
    })
  ).rejects.toBe(rollback);
  expect(await departuresFor(guest.userId)).toEqual([]);
  expect(await bindingEpoch(departure.bindingId)).toBe(epoch);
  expect(
    await query(
      sql`SELECT 1 FROM matrix_identities WHERE user_id=${guest.userId} AND matrix_id=${matrixId}`
    )
  ).toHaveLength(1);
  expect(
    await query(
      sql`SELECT 1 FROM account_deletion_requests WHERE user_id=${guest.userId}`
    )
  ).toHaveLength(0);
  expect(await journalFor(guest.userId)).toEqual([
    expect.objectContaining({
      userId: guest.userId,
      matrixIds: [matrixId],
      departures: [departure],
    }),
  ]);

  await transaction(async () => {
    await expect(applyAccountDeletionTombstones()).rejects.toMatchObject({
      reason: "unavailable",
    });
    expect(await departuresFor(guest.userId)).toEqual([]);
    expect(providers.matrixAttempts).toEqual([]);
  });
  expect(await departuresFor(guest.userId)).toEqual([]);
  expect(await bindingEpoch(departure.bindingId)).toBe(epoch);
  expect(
    await query(
      sql`SELECT 1 FROM matrix_identities WHERE user_id=${guest.userId} AND matrix_id=${matrixId}`
    )
  ).toHaveLength(1);
  expect(await journalFor(guest.userId)).toHaveLength(1);

  await applyAccountDeletionTombstones();
  expect(providers.matrixAttempts).toEqual([]);
  expect(await departuresFor(guest.userId)).toEqual([
    {
      bindingId: departure.bindingId,
      matrixId,
      ownerUserId: guest.userId,
    },
  ]);
  expect(await bindingEpoch(departure.bindingId)).not.toBe(epoch);
  expect(await matrixLedger(guest.userId)).toEqual({
    status: "pending_external",
    matrixIds: [matrixId],
  });
});
