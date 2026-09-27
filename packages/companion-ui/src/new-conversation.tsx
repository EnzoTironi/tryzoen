import { useRef, type ComponentProps } from "react";
import type { Client, ClientSession } from "eve/client";
import { Welcome } from "./welcome";

/** Start the first turn atomically so Eve can establish the session's owner. */
export function NewConversation({
  client,
  save,
  onCreated,
  ...welcome
}: Omit<ComponentProps<typeof Welcome>, "onSend"> & {
  readonly client: Client;
  readonly save: (sessionId: string, title: string) => Promise<unknown>;
  readonly onCreated: (sessionId: string, draft?: string) => void;
}) {
  const accepted = useRef<
    { session: ClientSession; message: string } | undefined
  >(undefined);
  return (
    <Welcome
      {...welcome}
      onSend={async (message) => {
        accepted.current ??= {
          session: (await client.sessions.create({ message })).session,
          message,
        };
        const id = accepted.current.session.state.sessionId;
        // A failed title write can be retried without replaying the accepted turn.
        await save(id, accepted.current.message.slice(0, 240));
        onCreated(
          id,
          message === accepted.current.message ? undefined : message
        );
      }}
    />
  );
}
