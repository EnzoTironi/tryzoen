import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";
import { env } from "@shared/environment/env";
import { query, transaction, TransactionBoundaryError } from "@db/queries";
import { workspaceFixture } from "./workspace-fixture";
import { requireWorkspaceAccess } from "../../server/workspaces/access";
import { publishWorkspaceGit } from "../../server/workspaces/git";
import {
  adoptPayload,
  putRegistered,
  readPayload,
  registerPayload,
} from "../../server/payloads/publication";
import { openPayloads } from "../../server/payloads/connection";
import {
  PayloadScopeSchema,
  type PayloadReference,
} from "../../server/payloads/contract";
import { operationSignal } from "../../server/operations/async";

describe("native payload publication", () => {
  let fixture: Awaited<ReturnType<typeof workspaceFixture>> | null = null;
  let scope: z.infer<typeof PayloadScopeSchema>;
  let bundle: Awaited<ReturnType<typeof publishWorkspaceGit>>;
  const retained: PayloadReference[] = [];

  function actor() {
    if (!fixture) throw new Error("The owned workspace fixture is not ready");
    return fixture.actor;
  }

  beforeAll(async () => {
    const database = new URL(env.DATABASE_URL);
    if (
      env.NODE_ENV !== "test" ||
      database.hostname !== "127.0.0.1" ||
      database.port !== "15432" ||
      database.pathname !== "/companion_runtime_test" ||
      env.ZOEN_PAYLOAD_ENDPOINT !== "http://127.0.0.1:19480" ||
      env.ZOEN_PAYLOAD_BUCKET !== "synthetic-storage-2a69cdcd"
    )
      throw new Error(
        "Native payload tests require the owned PostgreSQL and RustFS fixtures"
      );
    fixture = await workspaceFixture();
    scope = await transaction(async () => {
      await requireWorkspaceAccess(actor());
      const rows =
        await query(sql`SELECT payload_generation AS generation FROM workspaces
        WHERE id=${actor().workspaceId} FOR SHARE`);
      return PayloadScopeSchema.parse({
        workspaceId: actor().workspaceId,
        ownerGeneration: z.uuid().parse(rows[0]?.generation),
        ownerUserId: null,
        kind: "workspace-bundle",
      });
    });
    bundle = await publishWorkspaceGit({
      bundle: null,
      parent: null,
      changes: [
        {
          path: "knowledge/native-payload.md",
          content: "synthetic native payload",
        },
      ],
      message: "Synthetic native payload publication",
    });
  });

  afterAll(async () => {
    if (fixture) await fixture[Symbol.asyncDispose]();
    if (retained.length) {
      const connection = openPayloads();
      try {
        for (const reference of retained)
          await connection.payloads.removeExact({
            reference,
            signal: operationSignal(),
            deadlineMs: Date.now() + 10_000,
          });
      } finally {
        connection.close();
      }
    }
  });

  async function registered() {
    const reference = await transaction(async () => {
      await requireWorkspaceAccess(actor());
      return registerPayload(scope, bundle.bundle);
    });
    retained.push(reference);
    return reference;
  }

  it("refuses publication APIs outside the owner's transaction", async () => {
    await expect(registerPayload(scope, bundle.bundle)).rejects.toBeInstanceOf(
      TransactionBoundaryError
    );
    const reference = await registered();
    await expect(adoptPayload(reference)).rejects.toBeInstanceOf(
      TransactionBoundaryError
    );
    await expect(
      readPayload(scope, reference.candidateId)
    ).rejects.toBeInstanceOf(TransactionBoundaryError);
  });

  it("refuses external I/O while its upload intent remains uncommitted", async () => {
    await expect(
      transaction(async () => {
        await requireWorkspaceAccess(actor());
        const reference = await registerPayload(scope, bundle.bundle);
        await putRegistered(reference, bundle.bundle);
      })
    ).rejects.toBeInstanceOf(TransactionBoundaryError);
  });

  it("keeps unverified bytes unpublished and adopts verified bytes with their pointer atomically", async () => {
    const reference = await registered();
    await expect(
      transaction(() => adoptPayload(reference))
    ).rejects.toMatchObject({ reason: "invalid" });
    await putRegistered(reference, bundle.bundle);
    await transaction(async () => {
      await requireWorkspaceAccess(actor());
      await adoptPayload(reference);
      await query(sql`INSERT INTO workspace_repository(workspace_id,head_sha,payload_object_id)
        VALUES (${scope.workspaceId},${bundle.revision},${reference.candidateId})`);
    });
    expect(
      await transaction(async () => {
        await requireWorkspaceAccess(actor());
        const rows =
          await query(sql`SELECT payload_object_id AS id FROM workspace_repository
        WHERE workspace_id=${scope.workspaceId} FOR SHARE`);
        return Buffer.from(
          await readPayload(scope, z.uuid().parse(rows[0]?.id))
        );
      })
    ).toEqual(bundle.bundle);
  });

  it("rejects coordinate edits and collection of a live canonical reference", async () => {
    const rows = await transaction(() =>
      query(
        sql`SELECT payload_object_id AS id FROM workspace_repository WHERE workspace_id=${scope.workspaceId}`
      )
    );
    const id = z.uuid().parse(rows[0]?.id);
    await expect(
      transaction(() =>
        query(
          sql`UPDATE payload_object SET owner_generation=gen_random_uuid() WHERE id=${id}`
        )
      )
    ).rejects.toThrow("database operation failed");
    await expect(
      transaction(() =>
        query(sql`UPDATE payload_object SET state='deleting' WHERE id=${id}`)
      )
    ).rejects.toThrow("database operation failed");
    await expect(
      transaction(() => query(sql`DELETE FROM payload_object WHERE id=${id}`))
    ).rejects.toThrow("database operation failed");
    expect(
      Buffer.from(await transaction(() => readPayload(scope, id)))
    ).toEqual(bundle.bundle);
  });

  it("rejects a mismatched scope and retires the replaced reference in the pointer transaction", async () => {
    const [previous] = await transaction(() =>
      query(
        sql`SELECT payload_object_id AS id FROM workspace_repository WHERE workspace_id=${scope.workspaceId}`
      )
    );
    const oldId = z.uuid().parse(previous?.id);
    await expect(
      transaction(() =>
        readPayload({ ...scope, ownerGeneration: randomUUID() }, oldId)
      )
    ).rejects.toMatchObject({ reason: "invalid" });
    const reference = await registered();
    await putRegistered(reference, bundle.bundle);
    await transaction(async () => {
      await requireWorkspaceAccess(actor());
      await adoptPayload(reference);
      await query(
        sql`UPDATE workspace_repository SET payload_object_id=${reference.candidateId} WHERE workspace_id=${scope.workspaceId}`
      );
    });
    const rows = await transaction(() =>
      query(
        sql`SELECT retired_at IS NOT NULL AS retired FROM payload_object WHERE id=${oldId}`
      )
    );
    expect(rows[0]?.retired).toBe(true);
  });

  it("rolls adoption back when the canonical owner rejects the pointer", async () => {
    const reference = await transaction(() =>
      registerPayload(
        { ...scope, ownerGeneration: randomUUID() },
        bundle.bundle
      )
    );
    retained.push(reference);
    await putRegistered(reference, bundle.bundle);
    await expect(
      transaction(async () => {
        await requireWorkspaceAccess(actor());
        await adoptPayload(reference);
        await query(
          sql`UPDATE workspace_repository SET payload_object_id=${reference.candidateId} WHERE workspace_id=${scope.workspaceId}`
        );
      })
    ).rejects.toThrow("database operation failed");
    const rows = await transaction(() =>
      query(
        sql`SELECT state FROM payload_object WHERE id=${reference.candidateId}`
      )
    );
    expect(rows[0]?.state).toBe("pending");
  });
});
