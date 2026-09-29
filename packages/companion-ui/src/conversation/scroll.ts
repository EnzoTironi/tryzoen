import { useEffect, useRef } from "react";
import type { EveMessage } from "eve/react";
import type {
  FlatList,
  NativeScrollEvent,
  NativeSyntheticEvent,
} from "react-native";
import { captureMessageAnchor } from "./scroll-anchor";
import { listenHistoryIntent } from "../session/scroll-intent";

/** Owns initial positioning, reading anchors and intentional older-page loading. */
export function useConversationScroll({
  messages,
  loadingOlder,
  olderError,
  onLoadOlder,
}: {
  readonly messages: readonly EveMessage[];
  readonly loadingOlder: boolean;
  readonly olderError?: string;
  readonly onLoadOlder?: () => Promise<void>;
}) {
  const list = useRef<FlatList<EveMessage>>(null);
  const nearBottom = useRef(true);
  const positioned = useRef(false);
  const offset = useRef(0);
  const requested = useRef(false);
  const restore = useRef<(() => void) | undefined>(undefined);
  const connection = useRef<{ node?: unknown; cleanup?: () => void }>({});
  const current = useRef({ loadingOlder, olderError, onLoadOlder });
  useEffect(() => {
    current.current = { loadingOlder, olderError, onLoadOlder };
  }, [loadingOlder, olderError, onLoadOlder]);
  useEffect(() => {
    const state = connection.current;
    return () => {
      state.cleanup?.();
    };
  }, []);
  const load = (retry = false) => {
    const value = current.current;
    if (
      !value.onLoadOlder ||
      value.loadingOlder ||
      (!retry && value.olderError) ||
      requested.current
    )
      return;
    positioned.current = true;
    nearBottom.current = false;
    restore.current = captureMessageAnchor(
      list.current?.getScrollableNode(),
      "agent-message"
    );
    requested.current = true;
    void value.onLoadOlder().then(
      () => {
        requested.current = false;
      },
      () => {
        requested.current = false;
      }
    );
  };
  const connect = () => {
    const node: unknown = list.current?.getScrollableNode();
    if (connection.current.node === node) return;
    connection.current.cleanup?.();
    connection.current.node = node;
    connection.current.cleanup = listenHistoryIntent(node, () => {
      if (offset.current < 240) load();
    });
  };
  useEffect(() => {
    if (!messages.length || positioned.current) return undefined;
    const frame = requestAnimationFrame(() => {
      list.current?.scrollToEnd({ animated: false });
      positioned.current = true;
      nearBottom.current = true;
    });
    return () => {
      cancelAnimationFrame(frame);
    };
  }, [messages.length]);
  return {
    ref: list,
    retry: () => {
      load(true);
    },
    onLayout: () => {
      connect();
      if (nearBottom.current && messages.length)
        list.current?.scrollToEnd({ animated: false });
    },
    onScrollBeginDrag: () => {
      positioned.current = true;
      if (offset.current < 240) load();
    },
    onScroll: ({ nativeEvent }: NativeSyntheticEvent<NativeScrollEvent>) => {
      const atBottom =
        nativeEvent.contentSize.height -
          nativeEvent.contentOffset.y -
          nativeEvent.layoutMeasurement.height <
        100;
      const movedUp = nativeEvent.contentOffset.y < offset.current;
      offset.current = nativeEvent.contentOffset.y;
      if (positioned.current && movedUp && offset.current < 240) load();
      if (atBottom && offset.current > 0) positioned.current = true;
      if (positioned.current && !requested.current)
        nearBottom.current = atBottom;
      restore.current = nearBottom.current
        ? undefined
        : captureMessageAnchor(
            list.current?.getScrollableNode(),
            "agent-message"
          );
    },
    onContentSizeChange: () => {
      if (!nearBottom.current) restore.current?.();
      else list.current?.scrollToEnd({ animated: false });
    },
  };
}
