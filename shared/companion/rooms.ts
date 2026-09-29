import { roomReportResultSchema } from "@zoen/companion-ui/rooms";
import {
  roomPinsSchema,
  roomPinResultSchema,
  threadSubscriptionSchema,
  roomSendResultSchema,
  readReceiptPreferenceSchema,
} from "@zoen/companion-ui/rooms";
import { roomReactorsPageSchema } from "@zoen/companion-ui/rooms";
import { roomMembershipResultSchema } from "@zoen/companion-ui/rooms";
import { roomPresencePreferenceSchema } from "@zoen/companion-ui/rooms";
import {
  roomRenameResultSchema,
  roomNotificationsSchema,
  savedCleanupStateSchema,
  savedMessageStateSchema,
  savedMessagesPageSchema,
  saveMessageResultSchema,
  roomContextSchema,
  roomSearchPageSchema,
  roomForwardResultSchema,
} from "@zoen/companion-ui/rooms";
import { roomEditResultSchema } from "@zoen/companion-ui/rooms";
import { inlineAttachmentSchema } from "@zoen/companion-ui/messages";
import {
  roomSyncPageSchema,
  roomListSchema,
  directPeopleSchema,
  directListSchema,
  roomReactionsPageSchema,
  roomReactionSummarySchema,
  roomSchema,
  roomPageSchema,
  roomThreadPageSchema,
  type RoomData,
} from "@zoen/companion-ui/rooms";
import type { TRPCUntypedClient } from "@trpc/client";
import type { AnyRouter } from "@trpc/server";

export function companionRoomData(
  rpc: Pick<TRPCUntypedClient<AnyRouter>, "query" | "mutation">,
  operationId: () => string
): RoomData {
  return {
    operationId,
    async readReceiptPreference(input, signal) {
      return readReceiptPreferenceSchema.parse(
        await rpc.query("workspaces.rooms.readReceiptPreference", input, {
          signal,
        })
      );
    },
    async setReadReceiptPreference(input) {
      return readReceiptPreferenceSchema.parse(
        await rpc.mutation("workspaces.rooms.setReadReceiptPreference", input)
      );
    },
    async threadSubscription(input, signal) {
      return threadSubscriptionSchema.parse(
        await rpc.query("workspaces.rooms.threadSubscription", input, {
          signal,
        })
      );
    },
    async setThreadSubscription(input) {
      return threadSubscriptionSchema.parse(
        await rpc.mutation("workspaces.rooms.setThreadSubscription", input)
      );
    },
    async pins(input, signal) {
      return roomPinsSchema.parse(
        await rpc.query("workspaces.rooms.pins", input, { signal })
      );
    },
    async pin(input) {
      return roomPinResultSchema.parse(
        await rpc.mutation("workspaces.rooms.pin", input)
      );
    },
    async reactors(input, signal) {
      return roomReactorsPageSchema.parse(
        await rpc.query("workspaces.rooms.reactors", input, { signal })
      );
    },
    async presencePreference(input, signal) {
      return roomPresencePreferenceSchema.parse(
        await rpc.query("workspaces.rooms.presencePreference", input, {
          signal,
        })
      );
    },
    async setPresencePreference(input) {
      return roomPresencePreferenceSchema.parse(
        await rpc.mutation("workspaces.rooms.setPresencePreference", input)
      );
    },
    async changeMembership(input) {
      return roomMembershipResultSchema.parse(
        await rpc.mutation("workspaces.rooms.changeMembership", input)
      );
    },
    async setAvatar(input) {
      return roomRenameResultSchema.parse(
        await rpc.mutation("workspaces.rooms.setAvatar", input)
      );
    },
    async rename(input) {
      return roomRenameResultSchema.parse(
        await rpc.mutation("workspaces.rooms.rename", input)
      );
    },
    async notifications(input, signal) {
      return roomNotificationsSchema.parse(
        await rpc.query("workspaces.rooms.notifications", input, { signal })
      );
    },
    async setNotifications(input) {
      return roomNotificationsSchema.parse(
        await rpc.mutation("workspaces.rooms.setNotifications", input)
      );
    },
    async setTyping(input) {
      await rpc.mutation("workspaces.rooms.setTyping", input);
    },
    async readSync(input, signal) {
      return roomSyncPageSchema.parse(
        await rpc.query("workspaces.rooms.readSync", input, { signal })
      );
    },
    async savedCleanupState() {
      return savedCleanupStateSchema.parse(
        await rpc.query("workspaces.rooms.savedCleanupState")
      );
    },
    async clearUnavailableSavedMessages(input) {
      return saveMessageResultSchema.parse(
        await rpc.mutation(
          "workspaces.rooms.clearUnavailableSavedMessages",
          input
        )
      );
    },
    async savedMessageState(input) {
      return savedMessageStateSchema.parse(
        await rpc.query("workspaces.rooms.savedMessageState", input)
      );
    },
    async savedMessages(input) {
      return savedMessagesPageSchema.parse(
        await rpc.query("workspaces.rooms.savedMessages", input)
      );
    },
    async saveMessage(input) {
      return saveMessageResultSchema.parse(
        await rpc.mutation("workspaces.rooms.saveMessage", input)
      );
    },
    async search(input, signal) {
      return roomSearchPageSchema.parse(
        await rpc.query("workspaces.rooms.search", input, { signal })
      );
    },
    async context(input, signal) {
      return roomContextSchema.parse(
        await rpc.query("workspaces.rooms.context", input, { signal })
      );
    },
    async setUnread(input) {
      await rpc.mutation("workspaces.rooms.setUnread", input);
    },
    async markRead(input) {
      await rpc.mutation("workspaces.rooms.markRead", input);
    },
    async editMessage(input) {
      return roomEditResultSchema.parse(
        await rpc.mutation("workspaces.rooms.editMessage", input)
      );
    },
    async reportMessage(input) {
      return roomReportResultSchema.parse(
        await rpc.mutation("workspaces.rooms.reportMessage", input)
      );
    },
    async deleteMessage(input) {
      await rpc.mutation("workspaces.rooms.deleteMessage", input);
    },
    async forwardDestinations(input, signal) {
      return directListSchema.parse(
        await rpc.query("workspaces.rooms.forwardDestinations", input, {
          signal,
        })
      );
    },
    async forwardMessage(input) {
      return roomForwardResultSchema.parse(
        await rpc.mutation("workspaces.rooms.forwardMessage", input)
      );
    },
    async people(input) {
      return directPeopleSchema.parse(
        await rpc.query("workspaces.rooms.people", input)
      );
    },
    async openDirect(input) {
      return roomSchema.parse(
        await rpc.mutation("workspaces.rooms.openDirect", input)
      );
    },
    async directs(input) {
      return directListSchema.parse(
        await rpc.query("workspaces.rooms.directs", input)
      );
    },
    async media(input) {
      return inlineAttachmentSchema.parse(
        await rpc.query("workspaces.rooms.media", input)
      );
    },
    async reactions(input, signal) {
      return roomReactionsPageSchema.parse(
        await rpc.query("workspaces.rooms.reactions", input, { signal })
      );
    },
    async react(input) {
      return roomReactionSummarySchema.parse(
        await rpc.mutation("workspaces.rooms.react", input)
      );
    },
    async list() {
      return roomListSchema.parse(await rpc.query("workspaces.rooms.list"));
    },
    async create(input) {
      return roomSchema.parse(
        await rpc.mutation("workspaces.rooms.create", input)
      );
    },
    async messages(input, signal) {
      return roomPageSchema.parse(
        await rpc.query("workspaces.rooms.messages", input, { signal })
      );
    },
    async thread(input, signal) {
      return roomThreadPageSchema.parse(
        await rpc.query("workspaces.rooms.thread", input, { signal })
      );
    },
    async send(input) {
      return roomSendResultSchema.parse(
        await rpc.mutation("workspaces.rooms.send", input)
      );
    },
  };
}
