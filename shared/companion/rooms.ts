import {
  roomListSchema,
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
