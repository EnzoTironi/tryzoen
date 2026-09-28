import type { inlineAttachmentSchema } from "../attachments/schema";
import { conversationDraftSchema } from "../session/input";
import { z } from "zod";
import { messageReactionSchema } from "../reactions/schema";

export const roomSchema = z.object({
  id: z.string(),
  roomId: z.string(),
  label: z.string(),
  epoch: z.string(),
});
export const roomListSchema = z.object({
  configured: z.boolean(),
  mayManage: z.boolean(),
  rooms: z.array(roomSchema).max(20),
});
export const roomReadSchema = z.object({
  id: z.uuid(),
  from: z.string().min(1).max(2048).optional(),
});
export const roomThreadSchema = roomReadSchema.extend({
  rootId: z.string().startsWith("$").max(255),
});
export const roomCreateSchema = z.object({
  operationId: z.uuid(),
  name: z.string().trim().min(1).max(80),
});
export const roomSendSchema = z
  .object({
    id: z.uuid(),
    operationId: z.uuid(),
    text: z.string().trim().max(8000),
    files: conversationDraftSchema.shape.files.optional(),
    rootId: roomThreadSchema.shape.rootId.optional(),
    replyTo: roomThreadSchema.shape.rootId.optional(),
  })
  .refine(
    (input) =>
      (!!input.text || !!input.files?.length) &&
      conversationDraftSchema.safeParse({
        text: input.text,
        files: input.files ?? [],
      }).success
  );
export const roomMessageSchema = z.object({
  id: z.string(),
  media: z
    .object({
      filename: z.string(),
      mediaType: z.string(),
      size: z.number().optional(),
    })
    .optional(),
  text: z.string(),
  sender: z.string(),
  mine: z.boolean(),
  bot: z.boolean(),
  timestamp: z.number(),
  rootId: z.string().nullable(),
  replies: z.number().int().nonnegative(),
  senderId: z.string(),
  reply: z
    .object({ id: z.string(), text: z.string(), sender: z.string() })
    .nullable(),
});
export const roomMemberSchema = z.object({
  id: z.string(),
  name: z.string(),
  mine: z.boolean(),
  bot: z.boolean(),
  avatarUri: z.string().nullable().optional(),
  username: z.string().nullable().optional(),
});
export const roomPageSchema = z.object({
  room: roomSchema,
  members: z.array(roomMemberSchema).max(100),
  membersTruncated: z.boolean(),
  messages: z.array(roomMessageSchema).max(100),
  nextCursor: z.string().nullable(),
});
export const roomThreadPageSchema = roomPageSchema.extend({
  parent: roomMessageSchema,
});

export const roomReactionsReadSchema = z.object({
  id: roomReadSchema.shape.id,
  messageIds: z.array(roomThreadSchema.shape.rootId).min(1).max(12),
});
export const roomReactionWriteSchema = z.object({
  id: roomReadSchema.shape.id,
  messageId: roomThreadSchema.shape.rootId,
  emoji: messageReactionSchema.shape.emoji,
  previousEventId: roomThreadSchema.shape.rootId.optional(),
  operationId: z.uuid(),
});
export const roomReactionSummarySchema = z.object({
  messageId: z.string(),
  mine: z.string().nullable(),
  mineEventId: z.string().nullable(),
  reactions: z.array(
    z.object({ emoji: z.string(), count: z.number().int().positive() })
  ),
  complete: z.boolean(),
});
export const roomReactionsPageSchema = z
  .array(roomReactionSummarySchema)
  .max(12);

export const roomMediaReadSchema = z.object({
  id: roomReadSchema.shape.id,
  messageId: roomThreadSchema.shape.rootId,
});

export interface RoomData {
  media: (
    input: z.infer<typeof roomMediaReadSchema>
  ) => Promise<z.infer<typeof inlineAttachmentSchema>>;
  reactions: (
    input: z.infer<typeof roomReactionsReadSchema>
  ) => Promise<z.infer<typeof roomReactionsPageSchema>>;
  react: (
    input: z.infer<typeof roomReactionWriteSchema>
  ) => Promise<z.infer<typeof roomReactionSummarySchema>>;
  operationId: () => string;
  list: () => Promise<z.infer<typeof roomListSchema>>;
  create: (
    input: z.infer<typeof roomCreateSchema>
  ) => Promise<z.infer<typeof roomSchema>>;
  messages: (
    input: z.infer<typeof roomReadSchema>
  ) => Promise<z.infer<typeof roomPageSchema>>;
  thread: (
    input: z.infer<typeof roomThreadSchema>
  ) => Promise<z.infer<typeof roomThreadPageSchema>>;
  send: (input: z.infer<typeof roomSendSchema>) => Promise<void>;
}
