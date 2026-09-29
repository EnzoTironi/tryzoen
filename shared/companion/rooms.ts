import {
  savedCleanupStateSchema,
  savedMessageStateSchema,
  savedMessagesPageSchema,
  saveMessageResultSchema,
  roomContextSchema,
  roomSearchPageSchema,
} from "@zoen/companion-ui/rooms";
import { roomEditResultSchema } from "@zoen/companion-ui/rooms";
import { inlineAttachmentSchema } from "@zoen/companion-ui/messages";
import {
  roomTypingPageSchema,
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
    async setTyping(input) {
      await rpc.mutation("workspaces.rooms.setTyping", input);
    },
    async readTyping(input, signal) {
      return roomTypingPageSchema.parse(
        await rpc.query("workspaces.rooms.readTyping", input, { signal })
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
    async markRead(input) {
      await rpc.mutation("workspaces.rooms.markRead", input);
    },
    async editMessage(input) {
      return roomEditResultSchema.parse(
        await rpc.mutation("workspaces.rooms.editMessage", input)
      );
    },
    async deleteMessage(input) {
      await rpc.mutation("workspaces.rooms.deleteMessage", input);
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
    async reactions(input) {
      return roomReactionsPageSchema.parse(
        await rpc.query("workspaces.rooms.reactions", input)
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
    async messages(input) {
      return roomPageSchema.parse(
        await rpc.query("workspaces.rooms.messages", input)
      );
    },
    async thread(input) {
      return roomThreadPageSchema.parse(
        await rpc.query("workspaces.rooms.thread", input)
      );
    },
    async send(input) {
      await rpc.mutation("workspaces.rooms.send", input);
    },
  };
}
