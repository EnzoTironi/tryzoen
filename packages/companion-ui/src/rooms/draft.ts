import {
  useMemo,
  useCallback,
  useSyncExternalStore,
  type ComponentProps,
} from "react";
import {
  QueryObserver,
  useQueryClient,
  skipToken,
} from "@tanstack/react-query";
import type { z } from "zod";
import type { Composer } from "../composer";
import type { RoomData, roomMessageSchema } from "./schema";

interface RoomDraft {
  text: string;
  files?: NonNullable<Parameters<RoomData["send"]>[0]["files"]>;
  reply?: z.infer<typeof roomMessageSchema>;
  attempt?: Pick<
    Parameters<RoomData["send"]>[0],
    "operationId" | "text" | "replyTo" | "files"
  >;
  status: NonNullable<ComponentProps<typeof Composer>["sendStatus"]>;
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
        initialData: { text: "", status: "idle" },
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
  return {
    ...result.data,
    changeFiles: (files: NonNullable<RoomDraft["files"]>) => {
      client.setQueryData<RoomDraft>(key, (current) =>
        current && current.status !== "sending"
          ? { ...current, files, status: "idle" }
          : current
      );
    },
    change: (text: string) => {
      client.setQueryData<RoomDraft>(key, (current) =>
        current && current.status !== "sending"
          ? { ...current, text, status: "idle" }
          : current
      );
    },
    replyTo: (reply?: z.infer<typeof roomMessageSchema>) => {
      client.setQueryData<RoomDraft>(key, (current) =>
        current && current.status !== "sending"
          ? { ...current, reply, status: "idle" }
          : current
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
      if (!current || current.status === "sending")
        throw new Error("A message is already being sent.");
      const replyTo = current.reply?.id;
      const attempt =
        current.attempt?.text === text &&
        current.attempt.replyTo === replyTo &&
        JSON.stringify(current.attempt.files ?? []) ===
          JSON.stringify(files ?? [])
          ? current.attempt
          : {
              text,
              replyTo,
              ...(files?.length ? { files } : {}),
              operationId: data.operationId(),
            };
      client.setQueryData<RoomDraft>(key, {
        ...current,
        attempt,
        status: "sending",
      });
      try {
        await data.send({ id: roomId, rootId, ...attempt });
        if (
          client.getQueryData<RoomDraft>(key)?.attempt?.operationId !==
          attempt.operationId
        )
          return;
        client.setQueryData<RoomDraft>(key, { text: "", status: "idle" });
        void client.invalidateQueries({
          queryKey: ["matrix-messages", cacheScope, roomId],
        });
        if (rootId)
          void client.invalidateQueries({
            queryKey: ["matrix-thread", cacheScope, roomId, rootId],
          });
      } catch (error) {
        if (
          client.getQueryData<RoomDraft>(key)?.attempt?.operationId ===
          attempt.operationId
        )
          client.setQueryData<RoomDraft>(key, {
            ...current,
            attempt,
            status: "failed",
          });
        throw error;
      }
    },
  };
}
