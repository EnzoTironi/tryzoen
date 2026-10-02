import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { query } from "@db/queries";
import { lockMatrixOrganizations, lockMatrixRoomFences } from "./authority";

const coordinate = z
  .string()
  .min(1)
  .max(512)
  .regex(/^[^\s]+$/u);
export const MatrixErasureDepartureSchema = z.strictObject({
  bindingId: z.uuid(),
  matrixId: coordinate.startsWith("@"),
  roomId: coordinate.startsWith("!"),
  installationId: coordinate,
  workspaceId: z.string().min(1).max(200),
  organizationId: z.string().min(1).max(200).nullable(),
});
const bindingSchema = MatrixErasureDepartureSchema.omit({ matrixId: true });
const referenceLimit = 1024;

async function locate(
  userId: string,
  inherited: readonly z.infer<typeof MatrixErasureDepartureSchema>[]
) {
  const bindingIds = [...new Set(inherited.map((item) => item.bindingId))];
  const rows = await query(sql`
    SELECT b.id AS "bindingId", b.conversation_id AS "roomId", b.installation_id AS "installationId",
      b.workspace_id AS "workspaceId", w.organization_id AS "organizationId"
    FROM workspace_group_bindings b JOIN workspaces w ON w.id=b.workspace_id
    WHERE b.channel='matrix' AND (
      EXISTS (SELECT 1 FROM workspace_memberships m WHERE m.workspace_id=w.id AND m.user_id=${userId})
      OR EXISTS (SELECT 1 FROM matrix_room_members m WHERE m.binding_id=b.id AND m.user_id=${userId})
      OR EXISTS (SELECT 1 FROM matrix_erasure_departures d WHERE d.binding_id=b.id AND d.owner_user_id=${userId})
      OR ${
        inherited.length
          ? sql`(${sql.join(
              inherited.map(
                (item) =>
                  sql`(b.installation_id=${item.installationId} AND b.conversation_id=${item.roomId})`
              ),
              sql` OR `
            )})`
          : sql`false`
      }
      OR ${
        bindingIds.length
          ? sql`b.id IN (${sql.join(
              bindingIds.map((id) => sql`${id}::uuid`),
              sql`, `
            )})`
          : sql`false`
      })
    ORDER BY b.id LIMIT ${referenceLimit + 1}`);
  if (rows.length > referenceLimit)
    throw new Error("Matrix erasure exceeds its bounded capture capacity.");
  const bindings = z.array(bindingSchema).parse(rows);
  for (const reference of inherited) {
    const binding = bindings.find(
      (item) => item.bindingId === reference.bindingId
    );
    if (
      binding &&
      (binding.roomId !== reference.roomId ||
        binding.installationId !== reference.installationId ||
        binding.workspaceId !== reference.workspaceId ||
        binding.organizationId !== reference.organizationId)
    )
      throw new Error("A recorded native room locator changed.");
  }
  return bindings;
}

/** SQL-only capture. The caller's transaction must include journal publication
 * and identity deletion. Shared organization fences precede the complete room
 * set and binding rows; these locks confer no membership or provider authority.
 * First enrollment/native orphan recovery is a separate qualification boundary.
 */
export async function captureMatrixErasureDepartures(
  userId: string,
  inheritedDepartures: readonly z.infer<
    typeof MatrixErasureDepartureSchema
  >[] = []
) {
  const inherited = z
    .array(MatrixErasureDepartureSchema)
    .max(referenceLimit)
    .parse(inheritedDepartures);
  const before = await locate(userId, inherited);
  const memberships = await query<{ organizationId: string }>(
    sql`SELECT organization_id AS "organizationId" FROM organization_memberships WHERE user_id=${userId} LIMIT ${referenceLimit + 1}`
  );
  if (memberships.length > referenceLimit)
    throw new Error("Matrix erasure exceeds its bounded capture capacity.");
  await lockMatrixOrganizations(
    [
      ...memberships.map((row) => row.organizationId),
      ...before.flatMap((row) =>
        row.organizationId ? [row.organizationId] : []
      ),
    ],
    "update"
  );
  await lockMatrixRoomFences(before.map((row) => row.bindingId));
  for (const id of before.map((row) => row.bindingId).toSorted()) {
    const locked = await query(
      sql`SELECT id FROM workspace_group_bindings WHERE id=${id} FOR UPDATE`
    );
    if (locked.length !== 1)
      throw new Error("A native room locator disappeared.");
  }
  const after = await locate(userId, inherited);
  if (JSON.stringify(before) !== JSON.stringify(after))
    throw new Error(
      "The Matrix erasure frontier changed; retry before deletion."
    );
  const identities = await query<{ matrixId: string }>(
    sql`SELECT matrix_id AS "matrixId" FROM matrix_identities WHERE user_id=${userId} FOR UPDATE`
  );
  const pending = await query(sql`
    SELECT b.id AS "bindingId", d.matrix_id AS "matrixId", b.conversation_id AS "roomId", b.installation_id AS "installationId",
      b.workspace_id AS "workspaceId", w.organization_id AS "organizationId"
    FROM matrix_erasure_departures d JOIN workspace_group_bindings b ON b.id=d.binding_id
    JOIN workspaces w ON w.id=b.workspace_id WHERE d.owner_user_id=${userId} LIMIT ${referenceLimit + 1}`);
  if (pending.length > referenceLimit)
    throw new Error("Matrix erasure exceeds its bounded capture capacity.");
  const departures = new Map<
    string,
    z.infer<typeof MatrixErasureDepartureSchema>
  >();
  for (const item of [
    ...inherited,
    ...z.array(MatrixErasureDepartureSchema).parse(pending),
    ...after.flatMap((binding) =>
      identities
        .filter((identity) =>
          identity.matrixId.endsWith(`:${binding.installationId}`)
        )
        .map((identity) =>
          MatrixErasureDepartureSchema.parse({
            ...binding,
            matrixId: identity.matrixId,
          })
        )
    ),
    ...after.flatMap((binding) =>
      inherited
        .filter(
          (reference) =>
            reference.installationId === binding.installationId &&
            reference.roomId === binding.roomId
        )
        .map((reference) =>
          MatrixErasureDepartureSchema.parse({
            ...binding,
            matrixId: reference.matrixId,
          })
        )
    ),
  ]) {
    const key = JSON.stringify([item.bindingId, item.matrixId]);
    const prior = departures.get(key);
    if (prior && JSON.stringify(prior) !== JSON.stringify(item))
      throw new Error("A native erasure reference conflicts.");
    departures.set(key, item);
  }
  if (departures.size > referenceLimit)
    throw new Error("Matrix erasure exceeds its bounded capture capacity.");
  const changed = new Set<string>();
  for (const item of departures.values()) {
    if (!after.some((binding) => binding.bindingId === item.bindingId))
      continue;
    const inserted =
      await query(sql`INSERT INTO matrix_erasure_departures(binding_id,matrix_id,owner_user_id)
      VALUES (${item.bindingId},${item.matrixId},${userId}) ON CONFLICT(binding_id,matrix_id) DO NOTHING RETURNING binding_id`);
    if (inserted.length) changed.add(item.bindingId);
    else {
      const owner = await query(
        sql`SELECT owner_user_id FROM matrix_erasure_departures WHERE binding_id=${item.bindingId} AND matrix_id=${item.matrixId} AND owner_user_id=${userId}`
      );
      if (owner.length !== 1)
        throw new Error(
          "A native departure belongs to a different erasure owner."
        );
    }
  }
  for (const bindingId of [...changed].toSorted())
    await query(
      sql`UPDATE workspace_group_bindings SET epoch=${randomUUID()} WHERE id=${bindingId}`
    );
  return [...departures.entries()]
    .toSorted(([first], [second]) =>
      first < second ? -1 : first > second ? 1 : 0
    )
    .map(([, item]) => item);
}
