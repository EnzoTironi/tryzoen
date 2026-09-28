import { deleteMatrixMessage } from "../../server/matrix/message-actions";
import { inlineAttachmentSchema } from "@zoen/companion-ui/messages";
import {
  searchDirectPeople,
  openDirectRoom,
  listDirectRooms,
} from "../../server/matrix/direct";
import { readMatrixMedia } from "../../server/matrix/media/read";
import {
  roomDeleteSchema,
  roomCreateSchema,
  roomSchema,
  directPeopleSchema,
  directPeopleSearchSchema,
  directOpenSchema,
  directListInputSchema,
  directListSchema,
  roomMediaReadSchema,
  roomReactionsReadSchema,
  roomReactionsPageSchema,
  roomReactionWriteSchema,
  roomReactionSummarySchema,
  roomSendSchema,
  roomReadSchema,
  roomThreadSchema,
  roomPageSchema,
  roomThreadPageSchema,
} from "@zoen/companion-ui/rooms";
import { withSignal } from "../../server/operations/async";

import { workspaceProcedure } from "./workspace-procedure";
import {
  closeMatrixRoom,
  createMatrixRoom,
  listMatrixRooms,
  readMatrixMessages,
  sendMatrixMessage,
} from "../../server/matrix/rooms";

import {
  readMatrixReactions,
  setMatrixReaction,
} from "../../server/matrix/reactions";

export const workspaceRoomsRouter = {
  deleteMessage: workspaceProcedure
    .input(roomDeleteSchema)
    .mutation(({ ctx, input, signal }) =>
      withSignal(signal, () => deleteMatrixMessage(ctx.actor, input))
    ),
  people: workspaceProcedure
    .input(directPeopleSearchSchema)
    .output(directPeopleSchema)
    .query(({ ctx, input, signal }) =>
      withSignal(signal, () => searchDirectPeople(ctx.actor, input.query))
    ),
  openDirect: workspaceProcedure
    .input(directOpenSchema)
    .output(roomSchema)
    .mutation(({ ctx, input, signal }) =>
      withSignal(signal, () => openDirectRoom(ctx.actor, input))
    ),
  directs: workspaceProcedure
    .input(directListInputSchema)
    .output(directListSchema)
    .query(({ ctx, input, signal }) =>
      withSignal(signal, () => listDirectRooms(ctx.actor, input.before))
    ),
  media: workspaceProcedure
    .input(roomMediaReadSchema)
    .output(inlineAttachmentSchema)
    .query(({ ctx, input, signal }) =>
      withSignal(signal, () => readMatrixMedia(ctx.actor, input))
    ),
  reactions: workspaceProcedure
    .input(roomReactionsReadSchema)
    .output(roomReactionsPageSchema)
    .query(({ ctx, input, signal }) =>
      withSignal(signal, () => readMatrixReactions(ctx.actor, input))
    ),
  react: workspaceProcedure
    .input(roomReactionWriteSchema)
    .output(roomReactionSummarySchema)
    .mutation(({ ctx, input, signal }) =>
      withSignal(signal, () => setMatrixReaction(ctx.actor, input))
    ),
  list: workspaceProcedure.query(({ ctx, signal }) =>
    withSignal(signal, async () => listMatrixRooms(ctx.actor))
  ),
  create: workspaceProcedure
    .input(roomCreateSchema)
    .mutation(({ ctx, input, signal }) =>
      withSignal(signal, async () => createMatrixRoom(ctx.actor, input))
    ),
  thread: workspaceProcedure
    .input(roomThreadSchema)
    .output(roomThreadPageSchema)
    .query(({ ctx, input, signal }) =>
      withSignal(signal, () =>
        readMatrixMessages(ctx.actor, input.id, input.from, input.rootId).then(
          (result) => roomThreadPageSchema.parse(result)
        )
      )
    ),
  messages: workspaceProcedure
    .input(roomReadSchema)
    .output(roomPageSchema)
    .query(({ ctx, input, signal }) =>
      withSignal(signal, async () =>
        readMatrixMessages(ctx.actor, input.id, input.from)
      )
    ),
  send: workspaceProcedure
    .input(roomSendSchema)
    .mutation(({ ctx, input, signal }) =>
      withSignal(signal, async () => sendMatrixMessage(ctx.actor, input))
    ),
  close: workspaceProcedure
    .input(roomReadSchema)
    .mutation(({ ctx, input, signal }) =>
      withSignal(signal, async () => closeMatrixRoom(ctx.actor, input.id))
    ),
};
