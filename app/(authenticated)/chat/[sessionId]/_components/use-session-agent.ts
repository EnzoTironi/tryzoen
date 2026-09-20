"use client";

import { browserWorkspaceHeaders } from "@web/workspaces/navigation";

import {
  Client,
  defaultMessageReducer,
  isCurrentTurnBoundaryEvent,
  type InputResponse,
  type MessageStreamEvent,
  type RespondTurnOptions,
  type SendTurnOptions,
} from "eve/client";
import type { EveMessageData, UseEveAgentStatus } from "eve/react";
import type { UserContent } from "ai";
import {
  type Dispatch,
  type RefObject,
  type SetStateAction,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  readLatestSessionHistory,
  readOlderSessionHistory,
  type SessionHistoryPage,
} from "../_lib/session-history";
import type { ChatAgent } from "./chat-agent";
import { conversationStreamEvents } from "../_lib/message-events";

const client = new Client({
  host: "",
  headers: browserWorkspaceHeaders,
  redirect: "error",
});
const messageReducer = defaultMessageReducer();

export function useSessionAgent(sessionId: string): ChatAgent {
  const [history, setHistory] = useState<SessionHistoryPage>();
  const [status, setStatus] = useState<UseEveAgentStatus>("resuming");
  const [error, setError] = useState<Error>();
  const [isLoadingOlder, setIsLoadingOlder] = useState(false);
  const historyRef = useRef(history);
  const operationRef = useRef<Promise<void> | undefined>(undefined);

  const streamController = useRef<AbortController | undefined>(undefined);

  const followSession = useCallback(
    async (startIndex: number, signal: AbortSignal) => {
      const session = client.sessions.attach(sessionId, {
        streamIndex: startIndex,
      });
      let nextIndex = startIndex;
      try {
        // The native stream reconnects from its cursor and stays open while idle.
        // It is the only writer of live events, including turns from another tab.
        for await (const event of session.stream({ signal, startIndex })) {
          if (signal.aborted) return;
          nextIndex += 1;
          appendSessionEvent(historyRef, setHistory, event, nextIndex);
          if (isCurrentTurnBoundaryEvent(event)) {
            setStatus(
              operationRef.current ||
                hasPendingAuthorization(historyRef.current?.events ?? [])
                ? "streaming"
                : "ready"
            );
          } else if ("data" in event && "turnId" in event.data) {
            setStatus("streaming");
          }
          if (
            event.type === "session.completed" ||
            event.type === "session.failed"
          )
            return;
        }
        if (!signal.aborted)
          throw new Error("The conversation stream disconnected.");
      } catch (cause) {
        if (signal.aborted) return;
        setError(toError(cause));
        setStatus("error");
      }
    },
    [sessionId]
  );

  const resume = useCallback(async () => {
    streamController.current?.abort();
    const controller = new AbortController();
    streamController.current = controller;
    setStatus("resuming");
    setError(undefined);
    try {
      const current =
        historyRef.current ??
        (await readLatestSessionHistory(sessionId, controller.signal));
      if (controller.signal.aborted) return;
      historyRef.current = current;
      setHistory(current);
      const tail = current.events.at(-1);
      setStatus(
        (tail && !isCurrentTurnBoundaryEvent(tail)) ||
          hasPendingAuthorization(current.events)
          ? "streaming"
          : "ready"
      );
      void followSession(current.endIndex, controller.signal);
    } catch (cause) {
      if (controller.signal.aborted) return;
      setError(toError(cause));
      setStatus("error");
    }
  }, [followSession, sessionId]);

  useEffect(() => {
    const startup = setTimeout(() => void resume(), 0);
    return () => {
      clearTimeout(startup);
      streamController.current?.abort();
    };
  }, [resume]);

  const runOperation = useCallback((operation: () => Promise<void>) => {
    const activeOperation = operationRef.current;
    if (activeOperation)
      return Promise.reject(
        new Error("The conversation is already processing a turn.")
      );
    const promise = operation().finally(() => {
      if (operationRef.current !== promise) return;
      operationRef.current = undefined;
      const events = historyRef.current?.events ?? [];
      const tail = events.at(-1);
      if (
        tail &&
        isCurrentTurnBoundaryEvent(tail) &&
        !hasPendingAuthorization(events)
      )
        setStatus((current) => (current === "error" ? current : "ready"));
    });
    operationRef.current = promise;
    return promise;
  }, []);

  const send = useCallback(
    async <TOutput>(
      message: string | UserContent,
      options?: SendTurnOptions<TOutput>
    ) => {
      const activeOperation = operationRef.current;
      if (activeOperation && options?.turnPolicy === "steer") {
        const current = historyRef.current;
        if (!current) throw new Error("The conversation is still loading.");
        const session = client.sessions.attach(sessionId, {
          streamIndex: current.endIndex,
        });
        const response = await session.send(message, options);
        await response.result();
        await activeOperation;
        return;
      }

      await runOperation(async () => {
        const current = historyRef.current;
        if (!current) throw new Error("The conversation is still loading.");
        setError(undefined);
        setStatus("submitted");
        const session = client.sessions.attach(sessionId, {
          streamIndex: current.endIndex,
        });
        try {
          const response = await session.send(message, options);
          await response.result();
        } catch (cause) {
          setError(toError(cause));
          setStatus("error");
          throw cause;
        }
      });
    },
    [runOperation, sessionId]
  );

  const respond = useCallback(
    async <TOutput>(
      inputResponses: readonly InputResponse[],
      options?: RespondTurnOptions<TOutput>
    ) => {
      await runOperation(async () => {
        const current = historyRef.current;
        if (!current) throw new Error("The conversation is still loading.");
        setError(undefined);
        setStatus("submitted");
        const session = client.sessions.attach(sessionId, {
          streamIndex: current.endIndex,
        });
        try {
          const response = await session.respond(inputResponses, options);
          await response.result();
        } catch (cause) {
          setError(toError(cause));
          setStatus("error");
          throw cause;
        }
      });
    },
    [runOperation, sessionId]
  );

  const loadOlder = async () => {
    const current = historyRef.current;
    if (!current || current.startIndex === 0 || isLoadingOlder) return;
    setIsLoadingOlder(true);
    try {
      const older = await readOlderSessionHistory(
        sessionId,
        current.startIndex
      );
      const latest = historyRef.current;
      if (latest) {
        const next = {
          ...latest,
          events: [...older.events, ...latest.events],
          startIndex: older.startIndex,
        };
        historyRef.current = next;
        setHistory(next);
      }
    } catch (cause) {
      setError(toError(cause));
    } finally {
      setIsLoadingOlder(false);
    }
  };

  const events = useMemo(
    () => conversationStreamEvents(history?.events ?? emptyEvents),
    [history?.events]
  );
  const data = useMemo<EveMessageData>(
    () =>
      events.reduce(
        (current, event) => messageReducer.reduce(current, event),
        messageReducer.initial()
      ),
    [events]
  );

  return {
    cancel: async () => await client.sessions.attach(sessionId).cancel(),
    data,
    error,
    events,
    hasOlder: (history?.startIndex ?? 0) > 0,
    isLoadingOlder,
    loadOlder,
    respond,
    resume,
    send,
    status,
  };
}

const emptyEvents: readonly MessageStreamEvent[] = [];

function appendSessionEvent(
  historyRef: RefObject<SessionHistoryPage | undefined>,
  setHistory: Dispatch<SetStateAction<SessionHistoryPage | undefined>>,
  event: MessageStreamEvent,
  endIndex: number
) {
  const current = historyRef.current;
  if (!current) return;
  const next = {
    ...current,
    endIndex,
    events: current.events.some(
      (candidate) => candidate.meta.id === event.meta.id
    )
      ? current.events
      : [...current.events, event],
  };
  historyRef.current = next;
  setHistory(next);
}

function toError(cause: unknown) {
  return cause instanceof Error
    ? cause
    : new Error("The session request failed.");
}

function hasPendingAuthorization(events: readonly MessageStreamEvent[]) {
  const pending = new Set<string>();
  for (const event of events) {
    if (event.type === "authorization.required") pending.add(event.data.name);
    else if (event.type === "authorization.completed")
      pending.delete(event.data.name);
  }
  return pending.size > 0;
}
