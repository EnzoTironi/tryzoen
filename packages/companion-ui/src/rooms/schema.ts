import type { inlineAttachmentSchema } from "../attachments/schema";
import { conversationDraftSchema } from "../session/input";
import { z } from "zod";
import { messageReactionSchema } from "../reactions/schema";

export const roomSchema = z.object({
  id: z.string(),
  roomId: z.string(),
  label: z.string(),
  epoch: z.string(),
  kind: z.enum(["group", "direct"]),
  username: z.string().nullable().optional(),
  avatarUri: z.string().nullable().optional(),
});
export const directPersonSchema = z.object({
  name: z.string(),
  username: z.string(),
  avatarUri: z.string().nullable(),
});
export const directPeopleSchema = z.array(directPersonSchema).max(20);
export const directPeopleSearchSchema = z.object({
  query: z.string().trim().min(2).max(80),
});
export const directOpenSchema = z.object({
  username: z.string().regex(/^[a-z][a-z0-9_]{2,29}$/u),
  operationId: z.uuid(),
});
export const directListInputSchema = z.object({ before: z.uuid().optional() });
export const directListSchema = z.object({
  items: z.array(roomSchema).max(20),
  nextCursor: z.string().nullable(),
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
export const roomTypingWriteSchema = z.object({
  id: z.uuid(),
  typing: z.boolean(),
});
export const roomTypingReadSchema = z.object({
  id: z.uuid(),
  cursor: z.string().min(1).max(16384).optional(),
});
export const roomTypingPageSchema = z.object({
  status: z.enum(["ready", "unavailable"]),
  cursor: z.string().max(16384).nullable(),
  userIds: z.array(z.string().max(255)).max(100),
  expiresAt: z.number().int().nonnegative(),
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
export const roomDeleteSchema = z.object({
  id: roomReadSchema.shape.id,
  messageId: roomThreadSchema.shape.rootId,
  operationId: z.uuid(),
});
export const roomEditSchema = roomDeleteSchema.extend({
  text: z.string().trim().min(1).max(8000),
  expectedRevision: roomThreadSchema.shape.rootId,
});
export const roomReadPositionSchema = z.object({
  id: roomReadSchema.shape.id,
  messageId: roomThreadSchema.shape.rootId,
  rootId: roomThreadSchema.shape.rootId.optional(),
});
export const roomMessageSchema = z.object({
  redacted: z.boolean().optional(),
  editId: z.string().optional(),
  editedAt: z.number().optional(),
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
export const roomEditResultSchema = z.object({
  status: z.enum(["saved", "conflict"]),
  message: roomMessageSchema,
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

export const roomSearchQuerySchema = z.object({
  id: z.uuid(),
  query: z.string().trim().min(1).max(200),
  senderId: z.string().min(1).max(255).optional(),
  cursor: z.string().min(1).max(16384).optional(),
});
export const roomSearchPageSchema = z.object({
  items: z.array(roomMessageSchema).max(20),
  nextCursor: z.string().max(16384).nullable(),
});

export interface RoomData {
  search: (
    input: z.infer<typeof roomSearchQuerySchema>,
    signal: AbortSignal
  ) => Promise<z.infer<typeof roomSearchPageSchema>>;
  setTyping: (input: z.infer<typeof roomTypingWriteSchema>) => Promise<void>;
  readTyping: (
    input: z.infer<typeof roomTypingReadSchema>,
    signal: AbortSignal
  ) => Promise<z.infer<typeof roomTypingPageSchema>>;
  savedCleanupState: () => Promise<z.infer<typeof savedCleanupStateSchema>>;
  clearUnavailableSavedMessages: (
    input: z.infer<typeof savedCleanupSchema>
  ) => Promise<z.infer<typeof saveMessageResultSchema>>;
  savedMessageState: (
    input: z.infer<typeof roomMediaReadSchema>
  ) => Promise<z.infer<typeof savedMessageStateSchema>>;
  savedMessages: (
    input: z.infer<typeof savedMessagesQuerySchema>
  ) => Promise<z.infer<typeof savedMessagesPageSchema>>;
  saveMessage: (
    input: z.infer<typeof saveMessageSchema>
  ) => Promise<z.infer<typeof saveMessageResultSchema>>;
  context: (
    input: z.infer<typeof roomMediaReadSchema>,
    signal?: AbortSignal
  ) => Promise<z.infer<typeof roomContextSchema>>;
  editMessage: (
    input: z.infer<typeof roomEditSchema>
  ) => Promise<z.infer<typeof roomEditResultSchema>>;
  markRead: (input: z.infer<typeof roomReadPositionSchema>) => Promise<void>;
  deleteMessage: (input: z.infer<typeof roomDeleteSchema>) => Promise<void>;
  people: (
    input: z.infer<typeof directPeopleSearchSchema>
  ) => Promise<z.infer<typeof directPeopleSchema>>;
  openDirect: (
    input: z.infer<typeof directOpenSchema>
  ) => Promise<z.infer<typeof roomSchema>>;
  directs: (
    input: z.infer<typeof directListInputSchema>
  ) => Promise<z.infer<typeof directListSchema>>;
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

export const savedMessageCursorSchema = z.object({
  revision: z.string().length(64),
  after: z.uuid(),
});
export const savedMessagesQuerySchema = z.object({
  cursor: savedMessageCursorSchema.nullish(),
});
export const savedMessageItemSchema = z.object({
  key: z.uuid(),
  reference: roomMediaReadSchema,
  room: roomSchema.nullable(),
  message: roomMessageSchema.nullable(),
  savedAt: z.number().int().nonnegative(),
});
export const savedMessagesPageSchema = z.object({
  revision: z.string().length(64),
  items: z.array(savedMessageItemSchema).max(20),
  nextCursor: savedMessageCursorSchema.nullable(),
  reset: z.boolean(),
});
export const saveMessageSchema = roomMediaReadSchema.extend({
  saved: z.boolean(),
  expectedRevision: z.string().length(64),
});
export const saveMessageResultSchema = z.object({
  status: z.enum(["saved", "conflict"]),
  revision: z.string().length(64),
});
export const roomContextSchema = z.object({
  members: z.array(roomMemberSchema).max(100),
  room: roomSchema,
  target: roomMessageSchema,
  messages: z.array(roomMessageSchema).max(41),
  root: roomMessageSchema.nullable(),
});
export const savedMessageStateSchema = z.object({
  saved: z.boolean(),
  revision: z.string().length(64),
});

export const savedCleanupStateSchema = z.object({
  revision: z.string().length(64),
  count: z.number().int().min(0).max(100),
});
export const savedCleanupSchema = savedCleanupStateSchema.pick({
  revision: true,
});
