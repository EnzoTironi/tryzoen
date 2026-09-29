import {
  readRoomNotifications,
  setRoomNotifications,
} from "../../server/matrix/notifications";
import {
  roomNotificationsReadSchema,
  roomNotificationsWriteSchema,
  roomNotificationsSchema,
} from "@zoen/companion-ui/rooms";
import { searchMatrixMessages } from "../../server/matrix/search";
import {
  forwardMatrixMessage,
  listForwardDestinations,
} from "../../server/matrix/forward";
import {
  roomForwardSchema,
  roomForwardResultSchema,
  roomForwardDestinationsSchema,
  roomSearchQuerySchema,
  roomSearchPageSchema,
} from "@zoen/companion-ui/rooms";
import { setMatrixTyping } from "../../server/matrix/typing";
import { readMatrixRoomSync } from "../../server/matrix/sync/room";
import {
  roomTypingWriteSchema,
  roomSyncReadSchema,
  roomSyncPageSchema,
} from "@zoen/companion-ui/rooms";
import {
  readSavedMessageState,
  readSavedCleanupState,
  clearUnavailableSavedMessages,
  listSavedMatrixMessages,
  setSavedMatrixMessage,
} from "../../server/matrix/saved";
import { readMatrixContext } from "../../server/matrix/context";
import {
  savedCleanupSchema,
  savedCleanupStateSchema,
  savedMessageStateSchema,
  savedMessagesQuerySchema,
  savedMessagesPageSchema,
  saveMessageSchema,
  saveMessageResultSchema,
  roomContextSchema,
} from "@zoen/companion-ui/rooms";
import { editMatrixMessage } from "../../server/matrix/edits";
import { roomEditSchema, roomEditResultSchema } from "@zoen/companion-ui/rooms";
import { deleteMatrixMessage } from "../../server/matrix/message-actions";
import { markMatrixRoomRead } from "../../server/matrix/read-position";
import { inlineAttachmentSchema } from "@zoen/companion-ui/messages";
import {
  searchDirectPeople,
  openDirectRoom,
  listDirectRooms,
} from "../../server/matrix/direct";
import { readMatrixMedia } from "../../server/matrix/media/read";
import {
  roomDeleteSchema,
  roomReadPositionSchema,
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
  notifications: workspaceProcedure
    .input(roomNotificationsReadSchema)
    .output(roomNotificationsSchema)
    .query(({ ctx, input, signal }) =>
      withSignal(signal, () => readRoomNotifications(ctx.actor, input))
    ),
  setNotifications: workspaceProcedure
    .input(roomNotificationsWriteSchema)
    .output(roomNotificationsSchema)
    .mutation(({ ctx, input, signal }) =>
      withSignal(signal, () => setRoomNotifications(ctx.actor, input))
    ),
  forwardDestinations: workspaceProcedure
    .input(roomForwardDestinationsSchema)
    .output(directListSchema)
    .query(({ ctx, input, signal }) =>
      withSignal(signal, () => listForwardDestinations(ctx.actor, input))
    ),
  forwardMessage: workspaceProcedure
    .input(roomForwardSchema)
    .output(roomForwardResultSchema)
    .mutation(({ ctx, input, signal }) =>
      withSignal(signal, () => forwardMatrixMessage(ctx.actor, input))
    ),
  setTyping: workspaceProcedure
    .input(roomTypingWriteSchema)
    .mutation(({ ctx, input, signal }) =>
      withSignal(signal, () => setMatrixTyping(ctx.actor, input))
    ),
  readSync: workspaceProcedure
    .input(roomSyncReadSchema)
    .output(roomSyncPageSchema)
    .query(({ ctx, input, signal }) =>
      withSignal(signal, () => readMatrixRoomSync(ctx.actor, input))
    ),
  savedCleanupState: workspaceProcedure
    .output(savedCleanupStateSchema)
    .query(({ ctx, signal }) =>
      withSignal(signal, () => readSavedCleanupState(ctx.actor))
    ),
  clearUnavailableSavedMessages: workspaceProcedure
    .input(savedCleanupSchema)
    .output(saveMessageResultSchema)
    .mutation(({ ctx, input, signal }) =>
      withSignal(signal, () => clearUnavailableSavedMessages(ctx.actor, input))
    ),
  savedMessageState: workspaceProcedure
    .input(roomMediaReadSchema)
    .output(savedMessageStateSchema)
    .query(({ ctx, input, signal }) =>
      withSignal(signal, () => readSavedMessageState(ctx.actor, input))
    ),
  savedMessages: workspaceProcedure
    .input(savedMessagesQuerySchema)
    .output(savedMessagesPageSchema)
    .query(({ ctx, input, signal }) =>
      withSignal(signal, () => listSavedMatrixMessages(ctx.actor, input))
    ),
  saveMessage: workspaceProcedure
    .input(saveMessageSchema)
    .output(saveMessageResultSchema)
    .mutation(({ ctx, input, signal }) =>
      withSignal(signal, () => setSavedMatrixMessage(ctx.actor, input))
    ),
  search: workspaceProcedure
    .input(roomSearchQuerySchema)
    .output(roomSearchPageSchema)
    .query(({ ctx, input, signal }) =>
      withSignal(signal, () => searchMatrixMessages(ctx.actor, input))
    ),
  context: workspaceProcedure
    .input(roomMediaReadSchema)
    .output(roomContextSchema)
    .query(({ ctx, input, signal }) =>
      withSignal(signal, () => readMatrixContext(ctx.actor, input))
    ),
  markRead: workspaceProcedure
    .input(roomReadPositionSchema)
    .mutation(({ ctx, input, signal }) =>
      withSignal(signal, () => markMatrixRoomRead(ctx.actor, input))
    ),
  editMessage: workspaceProcedure
    .input(roomEditSchema)
    .output(roomEditResultSchema)
    .mutation(({ ctx, input, signal }) =>
      withSignal(signal, () => editMatrixMessage(ctx.actor, input))
    ),
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
