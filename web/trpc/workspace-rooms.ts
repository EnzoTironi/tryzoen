import { setMatrixRoomAvatar } from "../../server/matrix/avatar";
import { roomAvatarWriteSchema } from "@zoen/companion-ui/rooms";
import {
  readThreadSubscription,
  setThreadSubscription,
} from "../../server/matrix/thread-subscriptions";
import {
  threadSubscriptionReadSchema,
  threadSubscriptionWriteSchema,
  threadSubscriptionSchema,
} from "@zoen/companion-ui/rooms";
import {
  roomUnreadSchema,
  readReceiptPreferenceSchema,
  readReceiptPreferenceWriteSchema,
  roomPinsReadSchema,
  roomPinsSchema,
  roomPinWriteSchema,
  roomPinResultSchema,
} from "@zoen/companion-ui/rooms";
import { readMatrixPins, setMatrixPin } from "../../server/matrix/pins";
import {
  roomReactorsReadSchema,
  roomReactorsPageSchema,
} from "@zoen/companion-ui/rooms";
import { changeMatrixGroupMembership } from "../../server/matrix/membership";
import {
  readPresencePreference,
  updateMatrixPresence,
} from "../../server/matrix/presence";
import {
  roomPresencePreferenceSchema,
  roomPresenceWriteSchema,
} from "@zoen/companion-ui/rooms";
import {
  roomMembershipChangeSchema,
  roomMembershipResultSchema,
} from "@zoen/companion-ui/rooms";
import {
  readRoomNotifications,
  setRoomNotifications,
} from "../../server/matrix/notifications";
import {
  roomRenameSchema,
  roomRenameResultSchema,
  roomNotificationsReadSchema,
  roomNotificationsWriteSchema,
  roomNotificationsSchema,
} from "@zoen/companion-ui/rooms";
import { renameMatrixRoom } from "../../server/matrix/group-name";
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
import { reportMatrixMessage } from "../../server/matrix/reports";
import {
  roomReportSchema,
  roomReportResultSchema,
} from "@zoen/companion-ui/rooms";
import { deleteMatrixMessage } from "../../server/matrix/message-actions";
import {
  markMatrixRoomRead,
  readReadReceiptPreference,
  setReadReceiptPreference,
  setMatrixRoomUnread,
} from "../../server/matrix/read-position";
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
  readMatrixReactors,
  setMatrixReaction,
} from "../../server/matrix/reactions";

export const workspaceRoomsRouter = {
  readReceiptPreference: workspaceProcedure
    .input(roomReadSchema.pick({ id: true }))
    .output(readReceiptPreferenceSchema)
    .query(({ ctx, input, signal }) =>
      withSignal(signal, () => readReadReceiptPreference(ctx.actor, input.id))
    ),
  setReadReceiptPreference: workspaceProcedure
    .input(readReceiptPreferenceWriteSchema)
    .output(readReceiptPreferenceSchema)
    .mutation(({ ctx, input, signal }) =>
      withSignal(signal, () =>
        setReadReceiptPreference(ctx.actor, input.id, input.enabled)
      )
    ),
  pins: workspaceProcedure
    .input(roomPinsReadSchema)
    .output(roomPinsSchema)
    .query(({ ctx, input, signal }) =>
      withSignal(signal, () => readMatrixPins(ctx.actor, input))
    ),
  pin: workspaceProcedure
    .input(roomPinWriteSchema)
    .output(roomPinResultSchema)
    .mutation(({ ctx, input, signal }) =>
      withSignal(signal, () => setMatrixPin(ctx.actor, input))
    ),
  reactors: workspaceProcedure
    .input(roomReactorsReadSchema)
    .output(roomReactorsPageSchema)
    .query(({ ctx, input, signal }) =>
      withSignal(signal, () => readMatrixReactors(ctx.actor, input))
    ),
  presencePreference: workspaceProcedure
    .input(roomReadSchema.pick({ id: true }))
    .output(roomPresencePreferenceSchema)
    .query(({ ctx, input, signal }) =>
      withSignal(signal, () => readPresencePreference(ctx.actor, input.id))
    ),
  setPresencePreference: workspaceProcedure
    .input(roomPresenceWriteSchema)
    .output(roomPresencePreferenceSchema)
    .mutation(({ ctx, input, signal }) =>
      withSignal(signal, () =>
        updateMatrixPresence(ctx.actor, input.id, input.sharing)
      )
    ),
  changeMembership: workspaceProcedure
    .input(roomMembershipChangeSchema)
    .output(roomMembershipResultSchema)
    .mutation(({ ctx, input, signal }) =>
      withSignal(signal, () => changeMatrixGroupMembership(ctx.actor, input))
    ),
  setAvatar: workspaceProcedure
    .input(roomAvatarWriteSchema)
    .output(roomRenameResultSchema)
    .mutation(({ ctx, input, signal }) =>
      withSignal(signal, () => setMatrixRoomAvatar(ctx.actor, input))
    ),
  rename: workspaceProcedure
    .input(roomRenameSchema)
    .output(roomRenameResultSchema)
    .mutation(({ ctx, input, signal }) =>
      withSignal(signal, () => renameMatrixRoom(ctx.actor, input))
    ),
  threadSubscription: workspaceProcedure
    .input(threadSubscriptionReadSchema)
    .output(threadSubscriptionSchema)
    .query(({ ctx, input, signal }) =>
      withSignal(signal, () => readThreadSubscription(ctx.actor, input))
    ),
  setThreadSubscription: workspaceProcedure
    .input(threadSubscriptionWriteSchema)
    .output(threadSubscriptionSchema)
    .mutation(({ ctx, input, signal }) =>
      withSignal(signal, () => setThreadSubscription(ctx.actor, input))
    ),
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
  setUnread: workspaceProcedure
    .input(roomUnreadSchema)
    .mutation(({ ctx, input, signal }) =>
      withSignal(signal, () => setMatrixRoomUnread(ctx.actor, input))
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
  reportMessage: workspaceProcedure
    .input(roomReportSchema)
    .output(roomReportResultSchema)
    .mutation(({ ctx, input, signal }) =>
      withSignal(signal, () => reportMatrixMessage(ctx.actor, input))
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
