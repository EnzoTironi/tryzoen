import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
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
  const [observation, setObservation] = useState({
    data,
    enabled,
    visit: { cacheScope, roomId },
  });
  let currentObservation = observation;
  const sameVisit =
    observation.visit.cacheScope === cacheScope &&
    observation.visit.roomId === roomId;
  if (
    !sameVisit ||
    observation.data !== data ||
    observation.enabled !== enabled
  ) {
    currentObservation = {
      data,
      enabled,
      visit: sameVisit ? observation.visit : { cacheScope, roomId },
    };
    setObservation(currentObservation);
  }
  const [revision, setRevision] = useState(0);
  const lifetime = useRef<{
    observation: typeof observation;
    active: boolean;
    joined: boolean;
    stopped?: "cancelled" | "denied" | "error";
    abort?: () => void;
  }>(undefined);
  const [snapshot, setSnapshot] = useState<{
    observation: typeof observation;
    result?: Awaited<ReturnType<RoomData["participate"]>>;
    stopped?: NonNullable<typeof lifetime.current>["stopped"];
  }>();
  useLayoutEffect(() => {
    const previous = lifetime.current;
    const owner: NonNullable<typeof lifetime.current> = {
      observation: currentObservation,
      active: true,
      joined: false,
      stopped:
        previous?.observation.visit === currentObservation.visit
          ? previous.stopped
          : undefined,
    };
    // Publish controls before passive work, so an early Cancel also stops startup.
    lifetime.current = owner;
    return () => {
      owner.active = false;
      owner.joined = false;
      owner.abort?.();
    };
  }, [currentObservation]);
  useEffect(() => {
    const owner = lifetime.current;
    if (!owner || owner.observation !== currentObservation) return undefined;
    const {
      data: currentData,
      enabled: currentEnabled,
      visit,
    } = currentObservation;
    let foreground = AppState.currentState === "active";
    let disposed = false;
    let request: AbortController | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const allowed = () =>
      currentEnabled &&
      foreground &&
      onlineManager.isOnline() &&
      owner.active &&
      lifetime.current === owner &&
      !disposed &&
      !owner.stopped;
    const stop = () => {
      owner.joined = false;
      clearTimeout(timer);
      request?.abort();
      request = undefined;
    };
    owner.abort = stop;
    const confirm = async () => {
      if (!allowed() || request) return;
      const controller = new AbortController();
      request = controller;
      const stopped = () => controller.signal.aborted || !allowed();
      try {
        const result = roomParticipationSchema.parse(
          await currentData.participate({ id: visit.roomId }, controller.signal)
        );
        if (stopped()) return;
        if (
          (result.status === "joined" ? result.room.id : result.id) !==
          visit.roomId
        )
          throw new Error("Room participation returned a different room.");
        owner.joined = result.status === "joined";
        if (owner.joined) setRevision((value) => value + 1);
        setSnapshot({ observation: currentObservation, result });
        if (result.status === "pending")
          timer = setTimeout(() => void confirm(), result.retryAfterMs);
      } catch (error) {
        if (stopped()) return;
        owner.joined = false;
        owner.stopped = deniedSchema.safeParse(error).success
          ? "denied"
          : "error";
        setSnapshot({
          observation: currentObservation,
          stopped: owner.stopped,
        });
      } finally {
        if (request === controller) request = undefined;
      }
    };
    const resume = () => {
      if (disposed || !owner.active || lifetime.current !== owner) return;
      stop();
      if (owner.stopped) return;
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
      if (owner.abort === stop) owner.abort = undefined;
      listener.remove();
      unsubscribe();
    };
  }, [currentObservation]);
  const requireJoined = useCallback(() => {
    const owner = lifetime.current;
    if (
      !currentObservation.enabled ||
      owner?.observation !== currentObservation ||
      !owner.active ||
      !owner.joined ||
      owner.stopped ||
      AppState.currentState !== "active" ||
      !onlineManager.isOnline()
    )
      throw new Error("Room participation is not confirmed.");
  }, [currentObservation]);
  const current =
    snapshot?.observation === currentObservation ? snapshot : undefined;
  // A stop belongs to this visit, independently of visibility or transport replacement.
  const stopped =
    snapshot?.observation.visit === currentObservation.visit
      ? snapshot.stopped
      : undefined;
  const ready =
    currentObservation.enabled &&
    !stopped &&
    current?.result?.status === "joined";
  return {
    ready,
    revision,
    status: ready ? "joined" : (stopped ?? "pending"),
    requireJoined,
    cancel: () => {
      const owner = lifetime.current;
      if (owner?.observation !== currentObservation || !owner.active) return;
      owner.stopped = "cancelled";
      owner.abort?.();
      setSnapshot({ observation: currentObservation, stopped: "cancelled" });
    },
    retry: () => {
      const owner = lifetime.current;
      if (owner?.observation !== currentObservation || !owner.active) return;
      owner.active = false;
      owner.abort?.();
      owner.stopped = undefined;
      setSnapshot(undefined);
      setObservation((active) =>
        active === currentObservation ? { ...active } : active
      );
    },
  };
}
