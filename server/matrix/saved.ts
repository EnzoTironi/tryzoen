import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import { sql } from "drizzle-orm";
import { query, transaction } from "@db/queries";
import { lockMatrixAdmission } from "./authority";
import {
  savedCleanupSchema,
  roomMediaReadSchema,
  roomSchema,
  savedMessagesQuerySchema,
  savedMessagesPageSchema,
  saveMessageSchema,
} from "@zoen/companion-ui/rooms";
import {
  type WorkspaceActorSchema,
  requireWorkspaceAccess,
  WorkspaceAccessDenied,
} from "../workspaces/access";
import {
  matrixConfiguration,
  matrixRequest,
  MatrixError,
  MatrixEventSchema,
} from "./client";
import { ensureMatrixIdentity } from "./identities";
import { authorizedInboxRooms } from "./inbox";
import { joinMatrixRoom, requireMatrixRoom } from "./rooms";
import { readRoomMessage, projectMatrixMessage } from "./messages";
import { mapAsync } from "../operations/async";

const reference = z.object({
  key: z.uuid(),
  workspaceId: z.string().max(512),
  id: z.uuid(),
  roomId: z.string().max(512),
  eventId: z.string().max(512),
  savedAt: z.number().int().nonnegative(),
});
const collection = z.object({
  version: z.literal(1),
  items: z
    .array(reference)
    .max(100)
    .refine(
      (items) =>
        new Set(items.map((item) => item.key)).size === items.length &&
        new Set(
          items.map((item) =>
            JSON.stringify([item.workspaceId, item.id, item.eventId])
          )
        ).size === items.length,
      "Saved references must have unique identities."
    ),
});
const accountType = "org.zoen.saved_messages";
function revision(value: z.infer<typeof collection>) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}
function path(viewer: string) {
  return `user/${encodeURIComponent(viewer)}/account_data/${accountType}`;
}
async function readCollection(viewer: string) {
  try {
    return collection.parse(
      await matrixRequest("GET", path(viewer), undefined, viewer, {
        maxResponseBytes: 262144,
      })
    );
  } catch (error) {
    if (error instanceof MatrixError && error.reason === "not-found")
      return collection.parse({ version: 1, items: [] });
    throw error;
  }
}
async function identity(actor: z.infer<typeof WorkspaceActorSchema>) {
  await requireWorkspaceAccess(actor);
  if (!actor.authSessionId || actor.groupBindingId || actor.protocolTaskId)
    throw new WorkspaceAccessDenied();
  return ensureMatrixIdentity(actor);
}

/** Account data is a bounded private reference collection, never a content archive. */
export async function listSavedMatrixMessages(
  actor: z.infer<typeof WorkspaceActorSchema>,
  raw: z.infer<typeof savedMessagesQuerySchema>
) {
  const input = savedMessagesQuerySchema.parse(raw);
  const viewer = await identity(actor);
  const saved = await readCollection(viewer);
  const currentRevision = revision(saved);
  const reset =
    !!input.cursor &&
    (input.cursor.revision !== currentRevision ||
      !saved.items.some(
        (item) =>
          item.workspaceId === actor.workspaceId &&
          item.key === input.cursor?.after
      ));
  const scoped = saved.items.filter(
    (item) => item.workspaceId === actor.workspaceId
  );
  const rooms = await savedReferenceRooms(actor, scoped);
  const visible = scoped;
  const start =
    !reset && input.cursor
      ? visible.findIndex((item) => item.key === input.cursor?.after) + 1
      : 0;
  const selected = visible.slice(start, start + 20);
  const config = await matrixConfiguration();
  const items = await mapAsync(
    selected,
    (item) => hydrateSavedReference(item, rooms, viewer, config.botId),
    4
  );
  await requireWorkspaceAccess(actor);
  const finalRooms = await savedReferenceRooms(actor, selected);
  const last = selected.at(-1);
  return savedMessagesPageSchema.parse({
    revision: currentRevision,
    reset,
    items: items.map((item) => {
      const owner = item.room;
      if (
        owner &&
        !finalRooms.some(
          (room) => room.id === owner.id && room.roomId === owner.roomId
        )
      )
        return {
          key: item.key,
          reference: item.reference,
          room: null,
          message: null,
          savedAt: item.savedAt,
        };
      return item;
    }),
    nextCursor:
      last && start + 20 < visible.length
        ? { revision: currentRevision, after: last.key }
        : null,
  });
}

export async function setSavedMatrixMessage(
  actor: z.infer<typeof WorkspaceActorSchema>,
  raw: z.infer<typeof saveMessageSchema>
) {
  const input = saveMessageSchema.parse(raw);
  return transaction(async () => {
    await lockMatrixAdmission([actor.workspaceId], [input.id]);
    await query(
      sql`SELECT pg_advisory_xact_lock(hashtextextended(${JSON.stringify(["matrix-saved", actor.userId])},0))`
    );
    const viewer = await identity(actor);
    const saved = await readCollection(viewer);
    const currentRevision = revision(saved);
    const existing = saved.items.find(
      (item) =>
        item.workspaceId === actor.workspaceId &&
        item.id === input.id &&
        item.eventId === input.messageId
    );
    if (Boolean(existing) === input.saved)
      return { status: "saved" as const, revision: currentRevision };
    if (currentRevision !== input.expectedRevision)
      return { status: "conflict" as const, revision: currentRevision };
    let items = saved.items;
    if (input.saved) {
      if (items.length >= 100)
        throw new Error(
          "Você pode salvar até 100 mensagens. Remova uma antes de salvar outra."
        );
      const room = await joinMatrixRoom(actor, input.id);
      const event = await readRoomMessage(room, input.messageId);
      if (event.room_id !== room.roomId) throw new WorkspaceAccessDenied();
      items = [
        {
          key: randomUUID(),
          workspaceId: actor.workspaceId,
          id: input.id,
          roomId: room.roomId,
          eventId: input.messageId,
          savedAt: Date.now(),
        },
        ...items,
      ];
      await requireMatrixRoom(actor, input.id);
    } else items = items.filter((item) => item.key !== existing?.key);
    const next = collection.parse({ version: 1, items });
    await matrixRequest("PUT", path(viewer), next, viewer);
    await requireWorkspaceAccess(actor);
    const verified = await readCollection(viewer);
    return {
      status:
        revision(verified) === revision(next)
          ? ("saved" as const)
          : ("conflict" as const),
      revision: revision(verified),
    };
  });
}

export async function readSavedMessageState(
  actor: z.infer<typeof WorkspaceActorSchema>,
  raw: z.infer<typeof roomMediaReadSchema>
) {
  const input = roomMediaReadSchema.parse(raw);
  const saved = await readCollection(await identity(actor));
  await requireWorkspaceAccess(actor);
  return {
    revision: revision(saved),
    saved: saved.items.some(
      (item) =>
        item.workspaceId === actor.workspaceId &&
        item.id === input.id &&
        item.eventId === input.messageId
    ),
  };
}

async function hydrateSavedReference(
  item: z.infer<typeof reference>,
  rooms: z.infer<typeof roomSchema>[],
  viewer: string,
  botId: string
) {
  const room = rooms.find((candidate) => candidate.id === item.id);
  const unavailable = {
    key: item.key,
    reference: { id: item.id, messageId: item.eventId },
    room: null,
    message: null,
    savedAt: item.savedAt,
  };
  if (!room || room.roomId !== item.roomId) return unavailable;
  try {
    const event = MatrixEventSchema.parse(
      await matrixRequest(
        "GET",
        `rooms/${encodeURIComponent(item.roomId)}/event/${encodeURIComponent(item.eventId)}`,
        undefined,
        viewer,
        { maxResponseBytes: 262144 }
      )
    );
    if (
      event.event_id !== item.eventId ||
      event.room_id !== item.roomId ||
      event.type !== "m.room.message" ||
      event.content["m.relates_to"]?.rel_type === "m.replace"
    )
      return unavailable;
    return {
      key: item.key,
      reference: { id: item.id, messageId: item.eventId },
      room,
      message: projectMatrixMessage(event, [], viewer, botId),
      savedAt: item.savedAt,
    };
  } catch (error) {
    if (
      error instanceof MatrixError &&
      (error.reason === "not-found" || error.reason === "forbidden")
    )
      return unavailable;
    throw error;
  }
}

async function savedReferenceRooms(
  actor: z.infer<typeof WorkspaceActorSchema>,
  references: z.infer<typeof reference>[]
) {
  const authorized = await authorizedInboxRooms(actor);
  return z
    .array(roomSchema)
    .parse(
      await query(
        sql`SELECT * FROM (${authorized}) r WHERE id IN (SELECT value::text FROM jsonb_array_elements_text(${JSON.stringify(references.map((item) => item.id))}::jsonb))`
      )
    );
}

async function unavailableReferences(
  actor: z.infer<typeof WorkspaceActorSchema>,
  saved: z.infer<typeof collection>
) {
  const authorized = await authorizedInboxRooms(actor, "account");
  const rows = z
    .array(
      z.object({ id: z.string(), roomId: z.string(), workspaceId: z.string() })
    )
    .max(100)
    .parse(
      await query(
        sql`SELECT id,"roomId","workspaceId" FROM (${authorized}) rooms WHERE id IN (SELECT value FROM jsonb_array_elements_text(${JSON.stringify(saved.items.map((item) => item.id))}::jsonb))`
      )
    );
  // Binding IDs are globally unique; stored origin labels never grant access.
  return saved.items.filter(
    (item) =>
      !rows.some(
        (room) =>
          room.id === item.id &&
          room.roomId === item.roomId &&
          room.workspaceId === item.workspaceId
      )
  );
}
export async function readSavedCleanupState(
  actor: z.infer<typeof WorkspaceActorSchema>
) {
  const saved = await readCollection(await identity(actor));
  const unavailable = await unavailableReferences(actor, saved);
  await requireWorkspaceAccess(actor);
  return { revision: revision(saved), count: unavailable.length };
}
export async function clearUnavailableSavedMessages(
  actor: z.infer<typeof WorkspaceActorSchema>,
  raw: z.infer<typeof savedCleanupSchema>
) {
  const input = savedCleanupSchema.parse(raw);
  return transaction(async () => {
    await query(
      sql`SELECT pg_advisory_xact_lock(hashtextextended(${JSON.stringify(["matrix-saved", actor.userId])},0))`
    );
    const viewer = await identity(actor);
    const saved = await readCollection(viewer);
    if (revision(saved) !== input.revision)
      return { status: "conflict" as const, revision: revision(saved) };
    const unavailable = await unavailableReferences(actor, saved);
    if (!unavailable.length)
      return { status: "saved" as const, revision: revision(saved) };
    const removed = new Set(unavailable.map((item) => item.key));
    const next = collection.parse({
      version: 1,
      items: saved.items.filter((item) => !removed.has(item.key)),
    });
    await requireWorkspaceAccess(actor);
    await matrixRequest("PUT", path(viewer), next, viewer);
    const verified = await readCollection(viewer);
    return {
      status:
        revision(verified) === revision(next)
          ? ("saved" as const)
          : ("conflict" as const),
      revision: revision(verified),
    };
  });
}
