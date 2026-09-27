import type { EveMessage } from "eve/react";

export type MessageReply = Pick<EveMessage, "id" | "role"> & {
  readonly text: string;
};

export function messageText(message: EveMessage) {
  return message.parts
    .flatMap((part) => (part.type === "text" ? [part.text] : []))
    .join("\n\n");
}

/** The quotation is user content, so it survives history reloads without elevated trust. */
export function replyMessage(text: string, reply?: MessageReply) {
  if (!reply) return text;
  const excerpt =
    reply.text.length > 4000 ? `${reply.text.slice(0, 4000)}…` : reply.text;
  return `Reply to ${reply.role} message ${reply.id}:\n${excerpt
    .split(/\r?\n/u)
    .map((line) => `> ${line}`)
    .join("\n")}\n\n${text}`;
}

/** Presentation only: quoted text remains ordinary user input in durable history. */
export function readReplyMessage(content: string) {
  const match =
    /^Reply to (assistant|user) message ([^\r\n]{1,200}):\n((?:> [^\n]*\n)+)\n([\s\S]*)$/u.exec(
      content
    );
  if (!match) return undefined;
  return {
    role: match[1],
    id: match[2],
    quote:
      match[3]
        ?.trimEnd()
        .split("\n")
        .map((line) => line.slice(2))
        .join("\n") ?? "",
    text: match[4] ?? "",
  };
}
