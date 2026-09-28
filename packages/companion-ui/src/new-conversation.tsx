import { useRef, type ComponentProps } from "react";
import type { Client, ClientSession } from "eve/client";
import { Welcome } from "./welcome";
import {
  chatTitle,
  messageContent,
  type ConversationDraft,
} from "./session/input";

/** Start the first turn atomically so Eve can establish the session's owner. */
export function NewConversation({
  client,
  save,
  onCreated,
  ...welcome
}: Omit<ComponentProps<typeof Welcome>, "onSend"> & {
  readonly client: Client;
  readonly save: (sessionId: string, title: string) => Promise<unknown>;
  readonly onCreated: (sessionId: string, draft?: ConversationDraft) => void;
}) {
  const accepted = useRef<
    { session: ClientSession; message: ConversationDraft } | undefined
  >(undefined);
  return (
    <Welcome
      {...welcome}
      onSend={async (message) => {
        accepted.current ??= {
          session: (
            await client.sessions.create({ message: messageContent(message) })
          ).session,
          message,
        };
        const id = accepted.current.session.state.sessionId;
        // A failed title write can be retried without replaying the accepted turn.
        await save(id, chatTitle(accepted.current.message));
        const previous = accepted.current.message;
        const unchanged =
          message.text === previous.text &&
          message.files.length === previous.files.length &&
          message.files.every(
            (file, index) =>
              file.url === previous.files[index]?.url &&
              file.filename === previous.files[index].filename &&
              file.mediaType === previous.files[index].mediaType
          );
        onCreated(id, unchanged ? undefined : message);
      }}
    />
  );
}
