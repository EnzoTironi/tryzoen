import { useCallback, useEffect, useRef, useState } from "react";
import { AppState } from "react-native";
import { onlineManager } from "@tanstack/react-query";
import { z } from "zod";
import { roomParticipationSchema, type RoomData } from "./schema";

const deniedSchema = z.object({
  data: z.object({ code: z.enum(["FORBIDDEN", "UNAUTHORIZED"]) }),
});

/** Confirm participation before room reads; a visible pending join may retry. */
export function useRoomParticipation(
  data: Pick<RoomData, "participate">,
  cacheScope: string,
  roomId: string,
  enabled: boolean
) {
  const [attempt, setAttempt] = useState(0);
  const [revision, setRevision] = useState(0);
  const scope = JSON.stringify([cacheScope, roomId, enabled, attempt]);
  const lifetime = useRef<{
    data: typeof data;
    scope: string;
    joined: boolean;
    cancel?: () => void;
  }>(undefined);
  const [snapshot, setSnapshot] = useState<{
    data: typeof data;
    scope: string;
    result?: Awaited<ReturnType<RoomData["participate"]>>;
    failed?: boolean;
    denied?: boolean;
    cancelled?: boolean;
  }>();
  useEffect(() => {
    const owner: NonNullable<typeof lifetime.current> = {
      data,
      scope,
      joined: false,
    };
    lifetime.current = owner;
    let foreground = AppState.currentState === "active";
    let disposed = false;
    let cancelled = false;
    let terminal = false;
    let request: AbortController | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const allowed = () =>
      enabled &&
      foreground &&
      onlineManager.isOnline() &&
      !disposed &&
      !cancelled &&
      !terminal;
    const stop = () => {
      owner.joined = false;
      clearTimeout(timer);
      request?.abort();
      request = undefined;
    };
    const confirm = async () => {
      if (!allowed() || request) return;
      const controller = new AbortController();
      request = controller;
      const stopped = () => controller.signal.aborted || !allowed();
      try {
        const result = roomParticipationSchema.parse(
          await data.participate({ id: roomId }, controller.signal)
        );
        if (stopped()) return;
        if (
          (result.status === "joined" ? result.room.id : result.id) !== roomId
        )
          throw new Error("Room participation returned a different room.");
        owner.joined = result.status === "joined";
        if (owner.joined) setRevision((value) => value + 1);
        setSnapshot({ data, scope, result });
        if (result.status === "pending")
          timer = setTimeout(() => void confirm(), result.retryAfterMs);
      } catch (error) {
        if (stopped()) return;
        owner.joined = false;
        terminal = true;
        setSnapshot({
          data,
          scope,
          failed: true,
          denied: deniedSchema.safeParse(error).success,
        });
      } finally {
        if (request === controller) request = undefined;
      }
    };
    owner.cancel = () => {
      cancelled = true;
      stop();
      setSnapshot({ data, scope, cancelled: true });
    };
    const resume = () => {
      stop();
      if (terminal || cancelled) return;
      setSnapshot(undefined);
      if (allowed()) void confirm();
    };
    const listener = AppState.addEventListener("change", (state) => {
      foreground = state === "active";
      resume();
    });
    const unsubscribe = onlineManager.subscribe(resume);
    void confirm();
    return () => {
      disposed = true;
      stop();
      listener.remove();
      unsubscribe();
    };
  }, [data, scope, roomId, enabled]);
  const requireJoined = useCallback(() => {
    if (
      !enabled ||
      lifetime.current?.scope !== scope ||
      lifetime.current.data !== data ||
      !lifetime.current.joined ||
      AppState.currentState !== "active" ||
      !onlineManager.isOnline()
    )
      throw new Error("Room participation is not confirmed.");
  }, [data, scope, enabled]);
  const current =
    snapshot?.scope === scope && snapshot.data === data ? snapshot : undefined;
  const ready = enabled && current?.result?.status === "joined";
  const status = ready
    ? "joined"
    : current?.denied
      ? "denied"
      : current?.cancelled
        ? "cancelled"
        : current?.failed
          ? "error"
          : "pending";
  return {
    ready,
    revision,
    status,
    requireJoined,
    cancel: () => {
      if (lifetime.current?.scope === scope && lifetime.current.data === data)
        lifetime.current.cancel?.();
    },
    retry: () => {
      if (lifetime.current?.scope !== scope || lifetime.current.data !== data)
        return;
      lifetime.current.cancel?.();
      setAttempt((value) => value + 1);
    },
  };
}
