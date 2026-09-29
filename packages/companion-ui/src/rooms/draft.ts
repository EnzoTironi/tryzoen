import { useMemo, useCallback, useSyncExternalStore } from "react";
import {
  QueryObserver,
  useQueryClient,
  skipToken,
} from "@tanstack/react-query";
import type { z } from "zod";
import { useMessageOutbox } from "../conversation/outbox";
import type { RoomData, roomMessageSchema } from "./schema";

interface RoomDraft {
  text: string;
  files?: NonNullable<Parameters<RoomData["send"]>[0]["files"]>;
  reply?: z.infer<typeof roomMessageSchema>;
}

/** Navigation-only drafts: private to this query client and account/workspace scope. */
export function useRoomDraft(
  data: RoomData,
  cacheScope: string,
  roomId: string,
  rootId?: string
) {
  const client = useQueryClient();
  const key = ["matrix-draft", cacheScope, roomId, rootId ?? null] as const;
  // Controlled inputs need synchronous notifications. useQuery batches them,
  // which can restore the previous value/selection during rapid typing.
  const observer = useMemo(
    () =>
      new QueryObserver<RoomDraft>(client, {
        queryKey: ["matrix-draft", cacheScope, roomId, rootId ?? null],
        enabled: false,
        queryFn: skipToken,
        initialData: { text: "" },
        staleTime: Infinity,
        gcTime: 30 * 60_000,
      }),
    [client, cacheScope, roomId, rootId]
  );
  const subscribe = useCallback(
    (notify: () => void) => observer.subscribe(notify),
    [observer]
  );
  const snapshot = useCallback(() => observer.getCurrentResult(), [observer]);
  const result = useSyncExternalStore(subscribe, snapshot, snapshot);
  const outbox = useMessageOutbox<
    Parameters<RoomData["send"]>[0] & { quote?: RoomDraft["reply"] },
    void
  >(
    ["matrix-outbox", cacheScope, roomId],
    async ({ quote: _quote, ...input }) => {
      await data.send(input);
      void client.invalidateQueries({
        queryKey: ["conversation-inbox", cacheScope],
      });
      void client.invalidateQueries({
        queryKey: ["matrix-messages", cacheScope, roomId],
      });
      if (input.rootId)
        void client.invalidateQueries({
          queryKey: ["matrix-thread", cacheScope, roomId, input.rootId],
        });
    }
  );
  return {
    ...result.data,
    outgoing: outbox.entries.filter((entry) => entry.input.rootId === rootId),
    retry: outbox.retry,
    settle: outbox.remove,
    changeFiles: (files: NonNullable<RoomDraft["files"]>) => {
      client.setQueryData<RoomDraft>(
        key,
        (current) => current && { ...current, files }
      );
    },
    change: (text: string) => {
      client.setQueryData<RoomDraft>(
        key,
        (current) => current && { ...current, text }
      );
    },
    replyTo: (reply?: RoomDraft["reply"]) => {
      client.setQueryData<RoomDraft>(
        key,
        (current) => current && { ...current, reply }
      );
    },
    send: async ({
      text,
      files,
    }: {
      text: string;
      files?: RoomDraft["files"];
    }) => {
      const current = client.getQueryData<RoomDraft>(key);
      const operationId = data.operationId();
      outbox.enqueue(operationId, {
        id: roomId,
        rootId,
        operationId,
        text,
        files,
        replyTo: current?.reply?.id,
        quote: current?.reply,
      });
      client.setQueryData<RoomDraft>(key, { text: "" });
    },
  };
}
