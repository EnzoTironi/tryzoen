import type { z } from "zod";
import type { useRoomDraft } from "./draft";
import type { roomMessageSchema } from "./schema";

export type RoomMessageView = z.infer<typeof roomMessageSchema> & {
  outgoing?: Pick<
    ReturnType<typeof useRoomDraft>["outgoing"][number],
    "id" | "status" | "queued"
  > & {
    file?: NonNullable<ReturnType<typeof useRoomDraft>["files"]>[number];
  };
};

/** Match transport identities, including partial uploads; identical text is not identity. */
export function projectOutgoingRoomMessages(
  messages: z.infer<typeof roomMessageSchema>[],
  outgoing: ReturnType<typeof useRoomDraft>["outgoing"]
): { messages: RoomMessageView[]; settled: string[] } {
  const known = new Set(
    messages
      .filter((message) => message.mine)
      .map((message) => message.transactionId)
  );
  const pending: RoomMessageView[] = [];
  const settled: string[] = [];
  for (const entry of outgoing) {
    const { input } = entry;
    const parts = [
      ...(input.text
        ? [{ id: entry.id, text: input.text, file: undefined }]
        : []),
      ...(input.files ?? []).map((file, index) => ({
        id: `${entry.id}.file.${index}`,
        text: "",
        file,
      })),
    ];
    const missing = parts.filter((part) => !known.has(part.id));
    if (!missing.length) settled.push(entry.id);
    for (const part of missing) {
      pending.push({
        id: `local:${part.id}`,
        text: part.text,
        mine: true,
        bot: false,
        sender: "Você",
        senderId: "local",
        timestamp: entry.createdAt,
        rootId: input.rootId ?? null,
        replies: 0,
        reply: input.quote
          ? {
              id: input.quote.id,
              text: input.quote.text,
              sender: input.quote.sender,
            }
          : null,
        outgoing: {
          id: entry.id,
          status: entry.status,
          queued: entry.queued,
          file: part.file,
        },
      });
    }
  }
  return { messages: [...messages, ...pending], settled };
}
