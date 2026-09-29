import { useEffect, useRef, type RefObject } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { ConversationDraft } from "./input";
import type {
  Client,
  MessageResponse,
  MessageStreamEvent,
  SendTurnOptions,
} from "eve/client";
import type { EveMessage } from "eve/react";
import type { UserContent } from "ai";
import { useMessageOutbox } from "../conversation/outbox";
import type { SessionHistoryPage } from "./history";
import { isTerminalSession } from "./events";

// Local projection identity only; the runtime owns delivery and turn identities.
let nextSubmission = 0;
const submissionPrefix = `${Date.now().toString(36)}:${Math.random().toString(36).slice(2)}`;

export function useSessionSubmissions(
  client: Client,
  sessionId: string,
  cacheScope: string,
  history: RefObject<SessionHistoryPage | undefined>,
  responseRef: RefObject<Promise<MessageResponse> | undefined>,
  events: readonly MessageStreamEvent[]
) {
  const queries = useQueryClient();
  const responses = useRef(
    new Map<
      string,
      {
        response: ReturnType<typeof submissionPromise<MessageResponse>>;
        options?: SendTurnOptions;
      }
    >()
  );
  const prepare = (id: string, options?: SendTurnOptions) => {
    const response = submissionPromise<MessageResponse>();
    void response.promise.catch(() => undefined);
    responses.current.set(id, { response, options });
    responseRef.current = response.promise;
  };
  const fail = (id: string, cause: unknown) => {
    const pending = responses.current.get(id);
    if (!pending) return;
    pending.response.reject(cause);
    if (responseRef.current === pending.response.promise)
      responseRef.current = undefined;
    responses.current.delete(id);
  };
  const outbox = useMessageOutbox<
    {
      message: string | UserContent;
      turnPolicy?: SendTurnOptions["turnPolicy"];
      streamIndex: number;
    },
    Extract<MessageStreamEvent, { type: "message.received" }>
  >(
    ["agent-outbox", cacheScope, sessionId],
    async (input, id) => {
      const pending = responses.current.get(id);
      if (!pending)
        throw new Error("Review the recovered message before retrying.");
      const received =
        submissionPromise<
          Extract<MessageStreamEvent, { type: "message.received" }>
        >();
      // Consume only this submission's public response stream to correlate its echo.
      // Keep draining after receipt so Stop retains the exact native turn identity.
      void (async () => {
        try {
          const session = client.sessions.attach(sessionId, {
            streamIndex: history.current?.endIndex ?? 0,
          });
          const response = await session.send(input.message, {
            ...pending.options,
            turnPolicy: input.turnPolicy,
          });
          pending.response.resolve(response);
          for await (const event of response) {
            if (
              event.type === "message.received" &&
              event.data.kind !== "execution.background_task"
            )
              received.resolve(event);
          }
          received.reject(new Error("The message was not confirmed."));
        } catch (cause) {
          pending.response.reject(cause);
          received.reject(cause);
        } finally {
          responses.current.delete(id);
          if (responseRef.current === pending.response.promise)
            responseRef.current = undefined;
        }
      })();
      return received.promise;
    },
    fail
  );
  const confirmed = new Set(events.map((event) => event.meta.id));
  // The continuous stream can outrun the POST acknowledgement. Hold its new
  // projection until every local submission has an exact receipt; matching text
  // would incorrectly collapse identical messages or messages from another tab.
  const pendingFromIndex = outbox.entries.some(
    (entry) => entry.status === "sending" && !entry.receipt
  )
    ? Math.min(...outbox.entries.map((entry) => entry.input.streamIndex))
    : undefined;
  const settled = outbox.entries.filter(
    (entry) => entry.receipt && confirmed.has(entry.receipt.meta.id)
  );
  useEffect(() => {
    if (pendingFromIndex === undefined)
      outbox.remove(settled.map((entry) => entry.id));
  }, [outbox, settled, pendingFromIndex]);
  return {
    remove: (id: string) => {
      outbox.remove([id]);
    },
    pendingFromIndex,
    entries: outbox.entries.filter(
      (entry) =>
        pendingFromIndex !== undefined ||
        !entry.receipt ||
        !confirmed.has(entry.receipt.meta.id)
    ),
    retry: (id: string) => {
      const entry = outbox.entries.find((item) => item.id === id);
      if (
        !history.current ||
        entry?.status !== "failed" ||
        isTerminalSession(history.current.events)
      )
        return;
      prepare(id);
      outbox.retry(id, {
        ...entry.input,
        streamIndex: history.current.endIndex,
      });
    },
    send: async <TOutput>(
      message: string | UserContent,
      options?: SendTurnOptions<TOutput>
    ) => {
      const current = history.current;
      if (!current) throw new Error("The conversation is still loading.");
      if (isTerminalSession(current.events))
        throw new Error("This conversation has ended. Start a new chat.");
      const id = `local:${submissionPrefix}:${++nextSubmission}`;
      prepare(id, options);
      try {
        outbox.enqueue(id, {
          message,
          streamIndex: current.endIndex,
          turnPolicy: options?.turnPolicy ?? "steer",
        });
        queries.setQueryData<ConversationDraft>(
          ["agent-draft", cacheScope, sessionId],
          (savedDraft) => savedDraft && { text: "", files: [] }
        );
      } catch (cause) {
        fail(id, cause);
        throw cause;
      }
    },
  };
}

export function optimisticSessionMessage(
  entry: ReturnType<typeof useSessionSubmissions>["entries"][number]
): EveMessage {
  const content = entry.input.message;
  const parts: EveMessage["parts"] =
    typeof content === "string"
      ? [{ type: "text", text: content }]
      : content.flatMap((part): EveMessage["parts"] => {
          if (part.type === "text") return [{ type: "text", text: part.text }];
          if (part.type === "file" && typeof part.data === "string")
            return [
              {
                type: "file",
                url: part.data,
                mediaType: part.mediaType,
                filename: part.filename,
              },
            ];
          return [];
        });
  return {
    id: entry.id,
    role: "user",
    parts,
    metadata: {
      optimistic: true,
      status: entry.status === "failed" ? "failed" : "submitted",
    },
  };
}

function submissionPromise<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((accept, fail) => {
    resolve = accept;
    reject = fail;
  });
  return { promise, resolve, reject };
}
