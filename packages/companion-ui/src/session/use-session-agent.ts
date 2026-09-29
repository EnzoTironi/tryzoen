"use client";

import type { Client } from "eve/client";
import {
  defaultMessageReducer,
  isCurrentTurnBoundaryEvent,
  type InputResponse,
  type MessageResponse,
  type MessageStreamEvent,
  type RespondTurnOptions,
} from "eve/client";
import type { EveMessageData, UseEveAgentStatus } from "eve/react";
import { skipToken, useQuery, useQueryClient } from "@tanstack/react-query";
import { useSessionSubmissions, optimisticSessionMessage } from "./submissions";
import {
  type RefObject,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { readLatestSessionHistory, type SessionHistoryPage } from "./history";
import { useHistoryPages } from "./history-pages";
import type { ChatAgent } from "./types";
import { conversationStreamEvents, isTerminalSession } from "./events";

const messageReducer = defaultMessageReducer();

export function useSessionAgent(
  sessionId: string,
  client: Client,
  cacheScope: string
): ChatAgent {
  const queryClient = useQueryClient();
  const historyKey = useMemo(
    () => ["agent-live-history", cacheScope, sessionId],
    [cacheScope, sessionId]
  );
  const cached = useQuery<SessionHistoryPage>({
    queryKey: historyKey,
    queryFn: skipToken,
    staleTime: Infinity,
    gcTime: 30 * 60_000,
    structuralSharing: false,
  });
  const history = cached.data;
  const publishHistory = useCallback(
    (page: SessionHistoryPage) => {
      if (
        queryClient.getQueryCache().find({ queryKey: historyKey, exact: true })
      )
        queryClient.setQueryData(historyKey, page);
    },
    [historyKey, queryClient]
  );
  const [status, setStatus] = useState<UseEveAgentStatus>(
    history ? "ready" : "resuming"
  );
  const [error, setError] = useState<Error>();
  const olderPages = useHistoryPages(
    client,
    sessionId,
    cacheScope,
    history?.startIndex
  );
  const historyRef = useRef(history);
  const operationRef = useRef<Promise<void> | undefined>(undefined);
  const responseRef = useRef<Promise<MessageResponse> | undefined>(undefined);

  const streamController = useRef<AbortController | undefined>(undefined);

  const followSession = useCallback(
    async (
      startIndex: number,
      signal: AbortSignal,
      onPage: typeof publishHistory
    ) => {
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
          const next = appendSessionEvent(historyRef, event, nextIndex);
          if (next) onPage(next);
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
    [client, sessionId]
  );

  const resume = useCallback(async () => {
    streamController.current?.abort();
    const controller = new AbortController();
    streamController.current = controller;
    if (!historyRef.current) setStatus("resuming");
    setError(undefined);
    try {
      const current =
        historyRef.current ??
        (await readLatestSessionHistory(client, sessionId, controller.signal));
      if (controller.signal.aborted) return;
      historyRef.current = current;
      publishHistory(current);
      const tail = current.events.at(-1);
      setStatus(
        (tail && !isCurrentTurnBoundaryEvent(tail)) ||
          hasPendingAuthorization(current.events)
          ? "streaming"
          : "ready"
      );
      void followSession(current.endIndex, controller.signal, publishHistory);
    } catch (cause) {
      if (controller.signal.aborted) return;
      setError(toError(cause));
      setStatus("error");
    }
  }, [client, followSession, sessionId, publishHistory]);

  useEffect(() => {
    const startup = setTimeout(() => void resume(), 0);
    return () => {
      clearTimeout(startup);
      streamController.current?.abort();
    };
  }, [resume]);

  const runOperation = useCallback(
    (operation: (current: SessionHistoryPage) => Promise<MessageResponse>) => {
      const current = historyRef.current;
      if (!current)
        return Promise.reject(new Error("The conversation is still loading."));
      if (isTerminalSession(current.events))
        return Promise.reject(
          new Error("This conversation has ended. Start a new chat.")
        );
      const activeOperation = operationRef.current;
      if (activeOperation)
        return Promise.reject(
          new Error("The conversation is already processing a turn.")
        );
      setError(undefined);
      setStatus("submitted");
      const pendingResponse = operation(current);
      responseRef.current = pendingResponse;
      const promise = pendingResponse
        .then(async (response) => {
          await response.result();
          return undefined;
        })
        .catch((cause: unknown) => {
          setError(toError(cause));
          setStatus("error");
          throw cause;
        })
        .finally(() => {
          if (operationRef.current !== promise) return;
          operationRef.current = undefined;
          responseRef.current = undefined;
          const events = historyRef.current?.events ?? [];
          const tail = events.at(-1);
          if (
            tail &&
            isCurrentTurnBoundaryEvent(tail) &&
            !hasPendingAuthorization(events)
          )
            setStatus((previous) =>
              previous === "error" ? previous : "ready"
            );
        });
      operationRef.current = promise;
      return promise;
    },
    []
  );

  const respond = useCallback(
    async <TOutput>(
      inputResponses: readonly InputResponse[],
      options?: RespondTurnOptions<TOutput>
    ) => {
      await runOperation(async (current) => {
        const session = client.sessions.attach(sessionId, {
          streamIndex: current.endIndex,
        });
        return await session.respond(inputResponses, options);
      });
    },
    [client, runOperation, sessionId]
  );

  const loadOlder = async () => {
    const older = await olderPages.load();
    const latest = historyRef.current;
    if (!older || !latest || older.endIndex !== latest.startIndex) return;
    const next = {
      ...latest,
      events: [...older.events, ...latest.events],
      startIndex: older.startIndex,
    };
    historyRef.current = next;
    publishHistory(next);
  };

  const events = useMemo(
    () => conversationStreamEvents(history?.events ?? emptyEvents),
    [history?.events]
  );
  const submissions = useSessionSubmissions(
    client,
    sessionId,
    cacheScope,
    historyRef,
    responseRef,
    events
  );
  const data = useMemo<EveMessageData>(() => {
    const visibleEvents =
      submissions.pendingFromIndex === undefined
        ? events
        : conversationStreamEvents(
            (history?.events ?? emptyEvents).slice(
              0,
              Math.max(
                0,
                submissions.pendingFromIndex - (history?.startIndex ?? 0)
              )
            )
          );
    const projected = visibleEvents.reduce(
      (current, event) => messageReducer.reduce(current, event),
      messageReducer.initial()
    );
    const messages = [...projected.messages];
    for (const entry of submissions.entries) {
      if (entry.receipt) {
        const confirmed = messageReducer.reduce(
          messageReducer.initial(),
          entry.receipt
        );
        messages.push(...confirmed.messages);
      } else messages.push(optimisticSessionMessage(entry));
    }
    return { ...projected, messages };
  }, [events, history, submissions.entries, submissions.pendingFromIndex]);

  return {
    cancel: async () => {
      const pendingResponse = responseRef.current;
      try {
        return pendingResponse
          ? await (await pendingResponse).cancel()
          : await client.sessions.attach(sessionId).cancel();
      } catch (cause) {
        setError(toError(cause));
        throw cause;
      }
    },
    data,
    error,
    events,
    hasOlder: (history?.startIndex ?? 0) > 0,
    isLoadingOlder: olderPages.pending,
    olderError: olderPages.error,
    loadOlder,
    respond,
    resume,
    send: submissions.send,
    retrySend: submissions.retry,
    status:
      submissions.entries.some((entry) => entry.status === "sending") &&
      status === "ready"
        ? "submitted"
        : status,
  };
}

const emptyEvents: readonly MessageStreamEvent[] = [];

function appendSessionEvent(
  historyRef: RefObject<SessionHistoryPage | undefined>,
  event: MessageStreamEvent,
  endIndex: number
) {
  const current = historyRef.current;
  if (!current) return undefined;
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
  return next;
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
