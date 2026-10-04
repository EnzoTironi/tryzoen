import { sql } from "drizzle-orm";
import { z } from "zod";
import { query, transaction } from "@db/queries";
import { operationSignal, withDeadline } from "../operations/async";
import { PayloadError, PayloadReferenceSchema } from "./contract";
import { openPayloads } from "./connection";
import { privatePayloadEnvironment } from "@shared/environment/env/private-payloads";

async function retentionFloor() {
  const [inventory] = z
    .array(z.object({ oldest: z.coerce.date(), fresh: z.boolean() }))
    .max(1)
    .parse(
      await query(sql`SELECT oldest_backup_start AS oldest,
      observed_at BETWEEN clock_timestamp()-interval '5 minutes' AND clock_timestamp() AS fresh
      FROM zoen_maintenance.payload_backup_inventory WHERE repository='zoen'`)
    );
  if (!inventory?.fresh) throw new PayloadError("unavailable");
  return inventory.oldest;
}

async function collectNext() {
  return transaction(
    async () => {
      const oldest = await retentionFloor();
      const [candidate] = z
        .array(
          z.object({
            reference: PayloadReferenceSchema,
            quarantined: z.boolean(),
          })
        )
        .max(1)
        .parse(
          await query(sql`
      SELECT json_build_object('candidateId',p.id,'workspaceId',p.workspace_id,'ownerGeneration',p.owner_generation,
        'ownerUserId',p.owner_user_id,'kind',p.kind,'sha256',p.sha256,'byteLength',p.byte_length) AS reference,
        p.retired_at IS NOT NULL AS quarantined
      FROM payload_object p WHERE p.available_at <= clock_timestamp()
        AND NOT payload_is_referenced(p.id)
        AND (p.state<>'pending' OR p.write_until<=clock_timestamp())
        AND (p.retired_at IS NULL OR p.retired_at<${oldest}::timestamptz)
      ORDER BY p.available_at,p.id LIMIT 1 FOR UPDATE OF p SKIP LOCKED`)
        );
      if (!candidate) return null;
      const { quarantined, reference } = candidate;
      if (!quarantined) {
        // A restored pending row can have been adopted in a newer retained backup.
        // Fence future adoption now, then wait for backups beyond this discovery.
        await query(sql`UPDATE payload_object SET state='deleting',deleted_at=NULL,
          retired_at=clock_timestamp() WHERE id=${reference.candidateId}`);
        return { removed: 0 };
      }
      await query(
        sql`UPDATE payload_object SET state='deleting',deleted_at=NULL WHERE id=${reference.candidateId}`
      );
      try {
        await transaction(async () => {
          const connection = openPayloads();
          try {
            await connection.payloads.removeExact({
              reference,
              signal: operationSignal(),
              deadlineMs: Date.now() + 5000,
            });
          } finally {
            connection.close();
          }
          await query(sql`UPDATE payload_object SET state='deleted',deleted_at=clock_timestamp(),
          available_at=clock_timestamp()+interval '1 day' WHERE id=${reference.candidateId}`);
        });
        return { removed: 1 };
      } catch (error) {
        // Keep the outer coordinate lock and fence when the acknowledgement is
        // unknown. A later tick retries this same key; it never forgets the intent.
        await query(sql`UPDATE payload_object SET available_at=clock_timestamp()+interval '2 minutes'
        WHERE id=${reference.candidateId}`);
        return { removed: 0, error };
      }
    },
    { outermost: true }
  );
}

/** Discovery starts a new retention window. The object's upload time cannot
 * prove that a newer retained backup lacks its lost canonical reference. */
export async function discoverPayloadOrphans() {
  return withDeadline(
    () =>
      transaction(
        async () => {
          const prefix = privatePayloadEnvironment().ZOEN_PAYLOAD_PREFIX;
          await query(
            sql`INSERT INTO payload_inventory_cursor(prefix) VALUES (${prefix}) ON CONFLICT DO NOTHING`
          );
          const [cursor] = z
            .array(z.object({ token: z.string().nullable() }))
            .max(1)
            .parse(
              await query(
                sql`SELECT continuation_token AS token FROM payload_inventory_cursor WHERE prefix=${prefix} FOR UPDATE SKIP LOCKED`
              )
            );
          if (!cursor) return { scanned: 0, discovered: 0 };
          const connection = openPayloads();
          try {
            const page = await connection.payloads.inventoryPage({
              continuationToken: cursor.token,
              signal: operationSignal(),
              deadlineMs: Date.now() + 5000,
            });
            let discovered = 0;
            for (const object of page.objects) {
              // Registration may hold more than one candidate lock. A scanner never
              // waits while holding a different candidate, so it cannot deadlock it.
              const [lock] = z
                .array(z.object({ acquired: z.boolean() }))
                .length(1)
                .parse(
                  await query(
                    sql`SELECT pg_try_advisory_xact_lock(194805,hashtext(${object.candidateId})) AS acquired`
                  )
                );
              if (!lock?.acquired) continue;
              const inserted =
                await query(sql`INSERT INTO payload_orphan(id,object_key)
          SELECT ${object.candidateId},${object.key} WHERE NOT EXISTS(SELECT 1 FROM payload_object WHERE id=${object.candidateId})
          ON CONFLICT(id) DO NOTHING RETURNING id`);
              discovered += inserted.length;
            }
            await query(
              sql`UPDATE payload_inventory_cursor SET continuation_token=${page.continuationToken} WHERE prefix=${prefix}`
            );
            return { scanned: page.objects.length, discovered };
          } finally {
            connection.close();
          }
        },
        { outermost: true }
      ),
    Date.now() + 30_000
  );
}

async function collectNextOrphan() {
  return transaction(
    async () => {
      const oldest = await retentionFloor();
      const [orphan] = z
        .array(z.object({ id: z.uuid(), key: z.string().max(512) }))
        .max(1)
        .parse(
          await query(sql`SELECT id,object_key AS key FROM payload_orphan
        WHERE available_at<=clock_timestamp() AND discovered_at<${oldest}::timestamptz
        ORDER BY available_at,id LIMIT 1 FOR UPDATE SKIP LOCKED`)
        );
      if (!orphan) return null;
      try {
        await transaction(async () => {
          const connection = openPayloads();
          try {
            await connection.payloads.removeLocator({
              key: orphan.key,
              signal: operationSignal(),
              deadlineMs: Date.now() + 5000,
            });
          } finally {
            connection.close();
          }
          await query(
            sql`UPDATE payload_orphan SET deleted_at=clock_timestamp(),available_at=clock_timestamp()+interval '1 day' WHERE id=${orphan.id}`
          );
        });
        return { removed: 1 };
      } catch (error) {
        await query(
          sql`UPDATE payload_orphan SET available_at=clock_timestamp()+interval '2 minutes' WHERE id=${orphan.id}`
        );
        return { removed: 0, error };
      }
    },
    { outermost: true }
  );
}

export async function collectPayloadOrphans() {
  return withDeadline(async () => {
    let removed = 0;
    const failures: unknown[] = [];
    for (let attempt = 0; attempt < 25; attempt++) {
      const result = await collectNextOrphan();
      if (!result) break;
      removed += result.removed;
      if ("error" in result) failures.push(result.error);
    }
    if (failures.length)
      throw new AggregateError(
        failures,
        "Orphan payload collection has pending acknowledgements"
      );
    return { removed };
  }, Date.now() + 30_000);
}

/** Current pointers and readers share the native coordinate lock. Retired
 * bytes stay until every actually retained backup began after retirement. */
export async function collectPayloads() {
  return withDeadline(async () => {
    let removed = 0;
    const failures: unknown[] = [];
    for (let attempt = 0; attempt < 25; attempt++) {
      operationSignal().throwIfAborted();
      const result = await collectNext();
      if (!result) break;
      removed += result.removed;
      if ("error" in result) failures.push(result.error);
    }
    if (failures.length)
      throw new AggregateError(
        failures,
        "Private payload collection has pending acknowledgements"
      );
    return { removed };
  }, Date.now() + 30_000);
}
