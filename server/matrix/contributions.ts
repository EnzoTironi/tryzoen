import { createHash } from "node:crypto";
import { query, transaction } from "@db/queries";
import { sql } from "drizzle-orm";
import { z } from "zod";
import {
  CommunityContributionInputSchema,
  CommunityDestinationSchema,
} from "@zoen/companion-ui/approval";
import { accessScopeForUser } from "@shared/identity/access-scope";
import {
  requireWorkspaceAccess,
  WorkspaceAccessDenied,
  type WorkspaceActorSchema,
} from "../workspaces/access";
import { operationSignal } from "../operations/async";
import { lockMatrixAdmission, requireSafeMatrixAudience } from "./authority";
import { matrixConfiguration, matrixRequest, MatrixError } from "./client";
import { requireJoinedMatrixRoom } from "./rooms";

type Actor = z.output<typeof WorkspaceActorSchema>;
const publicationSchema = z.object({ event_id: z.string().min(1).max(256) });
const receiptSchema = z.object({
  ownerUserId: z.string(),
  requestHash: z.string(),
  eventId: z.string().nullable(),
});

function requirePersonalActor(actor: Actor) {
  if (
    !actor.authSessionId ||
    actor.groupBindingId ||
    actor.agentGrantId ||
    actor.protocolTaskId ||
    actor.workspaceId !== accessScopeForUser(actor.userId).workspaceId
  )
    throw new WorkspaceAccessDenied();
}

async function requirePersonalOwner(actor: Actor) {
  requirePersonalActor(actor);
  const access = await requireWorkspaceAccess(actor);
  if (access.organizationId || access.role !== "owner")
    throw new WorkspaceAccessDenied();
}

async function currentDestination(
  actor: Actor,
  workspaceId: string,
  id: string
) {
  const target = { ...actor, workspaceId };
  const access = await requireWorkspaceAccess(target);
  if (!access.organizationId) throw new WorkspaceAccessDenied();
  const room = await requireJoinedMatrixRoom(target, id);
  if (room.kind !== "group") throw new WorkspaceAccessDenied();
  await requireSafeMatrixAudience({
    ...access,
    groupBindingId: id,
    groupEpoch: room.epoch,
  });
  const labels = z.object({ communityName: z.string() }).parse(
    (
      await query(sql`SELECT coalesce(w.display_name, o.name) AS "communityName"
          FROM workspaces w JOIN organizations o ON o.id = w.organization_id
          WHERE w.id = ${workspaceId} FOR SHARE OF w, o`)
    )[0]
  );
  const config = await matrixConfiguration();
  const material = {
    workspaceId,
    channelId: id,
    roomId: room.roomId,
    communityName: labels.communityName,
    channelName: room.label,
  };
  return {
    destination: CommunityDestinationSchema.parse({
      ...material,
      revision: createHash("sha256")
        .update(
          JSON.stringify({
            ...material,
            epoch: room.epoch,
            matrixId: room.matrixId,
            serverName: config.serverName,
          })
        )
        .digest("hex"),
    }),
    matrixId: room.matrixId,
  };
}

export async function discoverContributionChannels(actor: Actor) {
  requirePersonalActor(actor);
  return transaction(async () => {
    const candidates = z
      .array(z.object({ workspaceId: z.string(), id: z.uuid() }))
      .parse(
        await query(sql`SELECT b.workspace_id AS "workspaceId", b.id
          FROM workspace_group_bindings b
          JOIN workspaces w ON w.id = b.workspace_id AND w.organization_id IS NOT NULL
          JOIN workspace_memberships m ON m.workspace_id = w.id AND m.user_id = ${actor.userId}
          JOIN organization_memberships o ON o.organization_id = w.organization_id AND o.user_id = m.user_id
          JOIN matrix_room_members r ON r.binding_id = b.id AND r.user_id = m.user_id
            AND r.state = 'joined' AND NOT r.native_pending
          WHERE b.channel = 'matrix' AND b.revoked_at IS NULL
          ORDER BY b.workspace_id, b.id LIMIT 24`)
      );
    await lockMatrixAdmission(
      [actor.workspaceId, ...candidates.map((item) => item.workspaceId)],
      candidates.map((item) => item.id)
    );
    await requirePersonalOwner(actor);
    const destinations: z.output<typeof CommunityDestinationSchema>[] = [];
    for (const candidate of candidates) {
      try {
        destinations.push(
          (await currentDestination(actor, candidate.workspaceId, candidate.id))
            .destination
        );
      } catch (error) {
        if (!(error instanceof WorkspaceAccessDenied)) throw error;
      }
    }
    return { destinations, limit: 24 };
  });
}

async function admitContribution(
  actor: Actor,
  destination: z.output<typeof CommunityDestinationSchema>
) {
  await lockMatrixAdmission(
    [actor.workspaceId, destination.workspaceId],
    [destination.channelId]
  );
  await requirePersonalOwner(actor);
  const current = await currentDestination(
    actor,
    destination.workspaceId,
    destination.channelId
  );
  if (JSON.stringify(current.destination) !== JSON.stringify(destination))
    throw new WorkspaceAccessDenied();
  return current;
}

async function readLockedReceipt(actor: Actor, operationId: string) {
  return receiptSchema.parse(
    (
      await query(sql`SELECT owner_user_id AS "ownerUserId", request_hash AS "requestHash", event_id AS "eventId"
        FROM matrix_contribution_receipts WHERE workspace_id = ${actor.workspaceId}
          AND operation_id = ${operationId} FOR UPDATE`)
    )[0]
  );
}

/** Called only after Eve's exact native approval. No proposal queue or auto-send. */
export async function publishCommunityContribution(
  actor: Actor,
  raw: z.output<typeof CommunityContributionInputSchema>
) {
  requirePersonalActor(actor);
  const input = CommunityContributionInputSchema.parse(raw);
  const { operationId } = input;
  const requestHash = createHash("sha256")
    .update(
      JSON.stringify({
        destination: input.destination,
        purpose: input.purpose,
        text: input.text,
      })
    )
    .digest("hex");
  // Commit the immutable hash before PUT; a lost response cannot release its ID.
  await transaction(
    async () => {
      await admitContribution(actor, input.destination);
      await query(sql`INSERT INTO matrix_contribution_receipts (workspace_id, operation_id, owner_user_id, request_hash)
      VALUES (${actor.workspaceId}, ${operationId}, ${actor.userId}, ${requestHash})
      ON CONFLICT (workspace_id, operation_id) DO NOTHING`);
      const receipt = await readLockedReceipt(actor, operationId);
      if (
        receipt.ownerUserId !== actor.userId ||
        receipt.requestHash !== requestHash
      )
        throw new MatrixError({ reason: "conflict" });
    },
    { outermost: true }
  );
  const publication = { attempted: false };
  try {
    return await transaction(
      async () => {
        const current = await admitContribution(actor, input.destination);
        const receipt = await readLockedReceipt(actor, operationId);
        if (
          receipt.ownerUserId !== actor.userId ||
          receipt.requestHash !== requestHash
        )
          throw new MatrixError({ reason: "conflict" });
        if (receipt.eventId)
          return {
            status: "published" as const,
            operationId,
            eventId: receipt.eventId,
          };
        operationSignal().throwIfAborted();
        const transactionId = `zoen-contribution-${createHash("sha256")
          .update(JSON.stringify([actor.workspaceId, operationId]))
          .digest("hex")}`;
        publication.attempted = true;
        const sent = publicationSchema.parse(
          await matrixRequest(
            "PUT",
            `rooms/${encodeURIComponent(input.destination.roomId)}/send/m.room.message/${transactionId}`,
            { msgtype: "m.text", body: input.text },
            current.matrixId
          )
        );
        await query(sql`UPDATE matrix_contribution_receipts SET event_id = ${sent.event_id}
        WHERE workspace_id = ${actor.workspaceId} AND operation_id = ${operationId}`);
        return {
          status: "published" as const,
          operationId,
          eventId: sent.event_id,
        };
      },
      { outermost: true }
    );
  } catch (error) {
    operationSignal().throwIfAborted();
    if (!publication.attempted) throw error;
    return { status: "pending" as const, operationId };
  }
}

export async function readContributionReceipt(
  actor: Actor,
  operationId: string
) {
  requirePersonalActor(actor);
  z.uuid().parse(operationId);
  return transaction(async () => {
    await lockMatrixAdmission([actor.workspaceId], []);
    await requirePersonalOwner(actor);
    const rows =
      await query(sql`SELECT event_id AS "eventId" FROM matrix_contribution_receipts
      WHERE workspace_id = ${actor.workspaceId} AND operation_id = ${operationId}
        AND owner_user_id = ${actor.userId}`);
    if (rows.length !== 1) throw new WorkspaceAccessDenied();
    const receipt = z.object({ eventId: z.string().nullable() }).parse(rows[0]);
    return receipt.eventId
      ? { status: "published" as const, operationId, eventId: receipt.eventId }
      : { status: "pending" as const, operationId };
  });
}
