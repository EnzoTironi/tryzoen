import { useRef, type ComponentProps } from "react";
import type { Client, ClientSession } from "eve/client";
import { Welcome } from "./welcome";

/** Persist the conversation before sending its first message, so failed history writes are retryable. */
export function NewConversation({
  client,
  save,
  onCreated,
  ...welcome
}: Omit<ComponentProps<typeof Welcome>, "onSend"> & {
  readonly client: Client;
  readonly save: (sessionId: string, title: string) => Promise<unknown>;
  readonly onCreated: (sessionId: string) => void;
}) {
  const session = useRef<ClientSession | undefined>(undefined);
  const saved = useRef(false);
  return (
    <Welcome
      {...welcome}
      onSend={async (message) => {
        session.current ??= (await client.sessions.create()).session;
        const id = session.current.state.sessionId;
        if (!saved.current) {
          await save(id, message.slice(0, 240));
          saved.current = true;
        }
        // send resolves once the server accepts the turn; the routed screen follows its durable stream.
        await session.current.send(message);
        onCreated(id);
      }}
    />
  );
}
