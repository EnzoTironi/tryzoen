"use client";

import { useI18n } from "@zoen/companion-ui/i18n";

import { Button } from "@web/components/ui/button";
import { cn } from "@web/components/class-names";
import { ArrowDownIcon } from "lucide-react";
import type { ComponentProps } from "react";
import {
  useCallback,
  useLayoutEffect,
  useRef,
  useSyncExternalStore,
} from "react";
import { StickToBottom, useStickToBottomContext } from "use-stick-to-bottom";
import { z } from "zod";

type ConversationProps = ComponentProps<typeof StickToBottom> & {
  scrollRestorationKey?: string;
};
type ConversationRenderChild = Extract<
  NonNullable<ConversationProps["children"]>,
  (...args: never[]) => React.ReactNode
>;

const scrollPositionSchema = z.object({
  atBottom: z.boolean(),
  scrollTop: z.number(),
});

export const Conversation = ({
  children,
  className,
  initial,
  scrollRestorationKey,
  ...props
}: ConversationProps) => {
  const parsedRenderer = z
    .custom<ConversationRenderChild>(
      (value) => z.function().safeParse(value).success
    )
    .safeParse(children);
  const renderChild = parsedRenderer.success ? parsedRenderer.data : undefined;
  return (
    <StickToBottom
      className={cn("relative flex-1 overflow-y-hidden", className)}
      initial={
        initial ?? (scrollRestorationKey === undefined ? "smooth" : false)
      }
      resize="smooth"
      role="log"
      {...props}
    >
      {renderChild ? (
        (context) => (
          <>
            {renderChild(context)}
            {scrollRestorationKey === undefined ? null : (
              <ConversationScrollRestoration
                storageKey={scrollRestorationKey}
              />
            )}
          </>
        )
      ) : (
        <>
          {children}
          {scrollRestorationKey === undefined ? null : (
            <ConversationScrollRestoration storageKey={scrollRestorationKey} />
          )}
        </>
      )}
    </StickToBottom>
  );
};

function ConversationScrollRestoration({
  storageKey,
}: {
  readonly storageKey: string;
}) {
  const { scrollRef, scrollToBottom, state } = useStickToBottomContext();
  const restoredKeyRef = useRef<string | undefined>(undefined);

  useLayoutEffect(() => {
    const scrollElement = scrollRef.current;
    if (scrollElement === null) return undefined;

    if (restoredKeyRef.current !== storageKey) {
      const saved = readScrollPosition(sessionStorage.getItem(storageKey));
      if (saved?.atBottom === false) {
        scrollElement.scrollTop = saved.scrollTop;
        requestAnimationFrame(() => {
          scrollElement.scrollTop = saved.scrollTop;
        });
      } else {
        scrollElement.scrollTop = scrollElement.scrollHeight;
        void scrollToBottom({ animation: "instant", ignoreEscapes: true });
      }
      restoredKeyRef.current = storageKey;
    }

    const saveNow = () => {
      sessionStorage.setItem(
        storageKey,
        JSON.stringify({
          atBottom: state.isAtBottom || state.isNearBottom,
          scrollTop: scrollElement.scrollTop,
        })
      );
    };
    let frame: number | undefined;
    const scheduleSave = () => {
      if (frame !== undefined) return;
      frame = requestAnimationFrame(() => {
        frame = undefined;
        saveNow();
      });
    };
    scrollElement.addEventListener("scroll", scheduleSave, { passive: true });
    window.addEventListener("pagehide", saveNow);
    return () => {
      scrollElement.removeEventListener("scroll", scheduleSave);
      window.removeEventListener("pagehide", saveNow);
      if (frame !== undefined) cancelAnimationFrame(frame);
      saveNow();
    };
  }, [scrollRef, scrollToBottom, state, storageKey]);

  return null;
}

function readScrollPosition(value: string | null):
  | {
      readonly atBottom: boolean;
      readonly scrollTop: number;
    }
  | undefined {
  if (value === null) return undefined;
  try {
    const parsed = scrollPositionSchema.safeParse(JSON.parse(value));
    return parsed.success ? parsed.data : undefined;
  } catch {
    return undefined;
  }
}

type ConversationContentProps = ComponentProps<typeof StickToBottom.Content>;

export const ConversationContent = ({
  className,
  ...props
}: ConversationContentProps) => (
  <StickToBottom.Content
    className={cn("flex flex-col gap-8 p-4", className)}
    {...props}
  />
);

type ConversationScrollButtonProps = ComponentProps<typeof Button>;

const unsubscribeFromHydration = () => undefined;
const subscribeToHydration = () => unsubscribeFromHydration;

export const ConversationScrollButton = ({
  className,
  ...props
}: ConversationScrollButtonProps) => {
  const { t } = useI18n();
  const { isAtBottom, scrollToBottom } = useStickToBottomContext();
  const isReady = useSyncExternalStore(
    subscribeToHydration,
    () => true,
    () => false
  );

  const handleScrollToBottom = useCallback(() => {
    void scrollToBottom();
  }, [scrollToBottom]);

  return (
    isReady &&
    !isAtBottom && (
      <Button
        aria-label={t("Scroll to bottom")}
        className={cn(
          "absolute bottom-32 left-[50%] translate-x-[-50%] rounded-full dark:bg-background dark:hover:bg-muted",
          className
        )}
        onClick={handleScrollToBottom}
        size="icon"
        type="button"
        variant="outline"
        {...props}
      >
        <ArrowDownIcon className="size-4" />
      </Button>
    )
  );
};
