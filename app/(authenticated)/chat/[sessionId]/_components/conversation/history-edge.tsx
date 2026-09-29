"use client";
import { useEffect, useLayoutEffect, useRef } from "react";
import { useStickToBottomContext } from "use-stick-to-bottom";
import {
  captureMessageAnchor,
  listenHistoryIntent,
  type ChatAgent,
} from "@zoen/companion-ui/session";
import { Button } from "@web/components/ui/button";
import { useI18n } from "@web/i18n/context";

export function HistoryEdge({
  history,
  firstMessageId,
}: {
  readonly history: Pick<
    ChatAgent,
    "hasOlder" | "isLoadingOlder" | "loadOlder" | "olderError"
  >;
  readonly firstMessageId?: string;
}) {
  const { t } = useI18n();
  const { scrollRef } = useStickToBottomContext();
  const current = useRef(history);
  const restore = useRef<(() => void) | undefined>(undefined);
  const requested = useRef(false);
  useLayoutEffect(() => {
    current.current = history;
  }, [history]);
  useLayoutEffect(() => {
    if (firstMessageId) restore.current?.();
  }, [firstMessageId]);
  useEffect(() => {
    const node = scrollRef.current;
    if (!node) return undefined;
    let intentional = false;
    let previous = node.scrollTop;
    const load = () => {
      const value = current.current;
      if (
        node.scrollTop >= 240 ||
        !value.hasOlder ||
        value.isLoadingOlder ||
        value.olderError ||
        requested.current
      )
        return;
      restore.current = captureMessageAnchor(node, "agent-message");
      requested.current = true;
      void value.loadOlder().then(
        () => {
          requested.current = false;
        },
        () => {
          requested.current = false;
        }
      );
    };
    const stopIntent = listenHistoryIntent(node, () => {
      intentional = true;
      load();
    });
    const scroll = () => {
      const up = node.scrollTop < previous;
      previous = node.scrollTop;
      if (!intentional) return;
      restore.current =
        node.scrollHeight - node.scrollTop - node.clientHeight < 100
          ? undefined
          : captureMessageAnchor(node, "agent-message");
      if (up) load();
    };
    node.addEventListener("scroll", scroll, { passive: true });
    return () => {
      stopIntent?.();
      node.removeEventListener("scroll", scroll);
    };
  }, [scrollRef]);
  if (history.olderError)
    return (
      <div role="alert">
        {t("Earlier messages couldn’t be loaded.")}
        <Button
          variant="ghost"
          onClick={() => {
            requested.current = false;
            void history.loadOlder().catch(() => undefined);
          }}
        >
          {t("Try again")}
        </Button>
      </div>
    );
  return history.isLoadingOlder ? <output>{t("Loading…")}</output> : null;
}
