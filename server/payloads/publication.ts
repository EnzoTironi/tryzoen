import { randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { sql } from "drizzle-orm";
import { z } from "zod";
import {
  query,
  requireDatabaseTransaction,
  transaction,
} from "../../db/queries";
import { operationSignal } from "../operations/async";
import {
  PayloadError,
  PayloadReferenceSchema,
  PayloadScopeSchema,
  type PayloadReference,
} from "./contract";
import { openPayloads } from "./connection";
import { payloadDigest } from "./s3";

const publicationSchema = z.object({
  reference: PayloadReferenceSchema,
  state: z.enum(["pending", "adopted", "deleting", "deleted"]),
  writeUntil: z.coerce.date(),
  verifiedAt: z.coerce.date().nullable(),
  writable: z.boolean(),
});

const publicationColumns = sql`json_build_object(
    'workspaceId', workspace_id, 'ownerGeneration', owner_generation,
    'ownerUserId', owner_user_id, 'kind', kind, 'candidateId', id,
    'sha256', sha256, 'byteLength', byte_length) AS reference,
  state, write_until AS "writeUntil", verified_at AS "verifiedAt",
  write_until > clock_timestamp() AS writable`;

async function lockedPublication(id: string, write: boolean) {
  const rows = await query(sql`SELECT ${publicationColumns}
    FROM payload_object WHERE id=${z.uuid().parse(id)}
    ${write ? sql`FOR UPDATE` : sql`FOR SHARE`}`);
  if (!rows[0]) throw new PayloadError("missing");
  return publicationSchema.parse(rows[0]);
}

/** The caller registers under its current domain-authority transaction. The
 * external write below refuses an outer transaction, so this intent is durable. */
export async function registerPayload(
  rawScope: z.input<typeof PayloadScopeSchema>,
  bytes: Uint8Array
): Promise<PayloadReference> {
  requireDatabaseTransaction();
  const scope = PayloadScopeSchema.parse(rawScope);
  const reference = PayloadReferenceSchema.parse({
    ...scope,
    candidateId: randomUUID(),
    sha256: payloadDigest(bytes),
    byteLength: bytes.byteLength,
  });
  return transaction(async () => {
    await query(sql`INSERT INTO payload_object
      (id, workspace_id, owner_generation, owner_user_id, kind, sha256, byte_length, created_at, write_until)
      SELECT ${reference.candidateId}, ${reference.workspaceId}, ${reference.ownerGeneration},
        ${reference.ownerUserId}, ${reference.kind}, ${reference.sha256}, ${reference.byteLength},
        instant, instant + interval '2 minutes' FROM (SELECT clock_timestamp() AS instant) clock`);
    return reference;
  });
}

/** Permission belongs to the domain owner. Coordinates must match the durable
 * intent; an incomplete or unknown outcome never establishes a publication. */
export async function putRegistered(
  reference: PayloadReference,
  bytes: Uint8Array
): Promise<void> {
  const input = PayloadReferenceSchema.parse(reference);
  const record = await transaction(
    async () => {
      const stored = await lockedPublication(input.candidateId, false);
      if (
        stored.state !== "pending" ||
        !stored.writable ||
        !isDeepStrictEqual(stored.reference, input)
      )
        throw new PayloadError("invalid");
      return stored;
    },
    { outermost: true }
  );
  const connection = openPayloads();
  try {
    await connection.payloads.putVerified({
      candidate: input,
      bytes,
      signal: operationSignal(),
      deadlineMs: Math.min(
        Date.now() + 30_000,
        record.writeUntil.getTime() - 1000
      ),
    });
  } finally {
    connection.close();
  }
  await transaction(
    async () => {
      const stored = await lockedPublication(input.candidateId, true);
      if (
        stored.state !== "pending" ||
        !stored.writable ||
        !isDeepStrictEqual(stored.reference, input)
      )
        throw new PayloadError("invalid");
      await query(sql`UPDATE payload_object SET verified_at=COALESCE(verified_at,clock_timestamp())
      WHERE id=${input.candidateId}`);
    },
    { outermost: true }
  );
}

/** Call inside the final authority/CAS transaction. Publication triggers verify
 * the pointer's canonical scope and prevent referencing deleting coordinates. */
export async function adoptPayload(reference: PayloadReference) {
  requireDatabaseTransaction();
  const input = PayloadReferenceSchema.parse(reference);
  const stored = await lockedPublication(input.candidateId, true);
  if (
    stored.state !== "pending" ||
    !stored.writable ||
    stored.verifiedAt === null ||
    !isDeepStrictEqual(stored.reference, input)
  )
    throw new PayloadError("invalid");
  const adopted =
    await query(sql`UPDATE payload_object SET state='adopted', adopted_at=clock_timestamp()
    WHERE id=${input.candidateId} AND state='pending' AND verified_at IS NOT NULL
      AND write_until > clock_timestamp() RETURNING id`);
  if (adopted.length !== 1) throw new PayloadError("invalid");
}

/** Hold the reference row until bounded GET verification ends. The caller's
 * outer authority and canonical owner locks remain held through this savepoint. */
export async function readPayload(
  rawScope: z.input<typeof PayloadScopeSchema>,
  id: string
) {
  requireDatabaseTransaction();
  const scope = PayloadScopeSchema.parse(rawScope);
  return transaction(async () => {
    const record = await lockedPublication(id, false);
    const { candidateId, sha256, byteLength, ...recordScope } =
      record.reference;
    if (record.state !== "adopted" || !isDeepStrictEqual(scope, recordScope))
      throw new PayloadError("invalid");
    const connection = openPayloads();
    try {
      return await connection.payloads.readVerified({
        reference: { ...recordScope, candidateId, sha256, byteLength },
        signal: operationSignal(),
        deadlineMs: Date.now() + 30_000,
      });
    } finally {
      connection.close();
    }
  });
}
