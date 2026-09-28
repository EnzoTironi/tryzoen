"use client";

import { useI18n } from "@web/i18n/context";

import type { MessageStreamEvent } from "eve/client";
import { ListTreeIcon } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@web/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@web/components/ui/dialog";
import {
  collectSubagentSessions,
  getSubagentStatus,
} from "@app/_lib/subagent-sessions";
import type { ChatUsage } from "@shared/chat/schema";
import type { TraceView } from "../../_lib/trace-view";
import { ActivityCard } from "./card";
import { TracePreview } from "./preview";
import { useChatUsage } from "./use-chat-usage";

const emptyEventsBySession = new Map<string, readonly MessageStreamEvent[]>();

export function SubagentPanel({
  events,
  historyComplete,
  initialUsage,
  onTraceViewChange,
  sessionId,
  traceView,
}: {
  readonly events: readonly MessageStreamEvent[];
  readonly historyComplete: boolean;
  readonly initialUsage?: ChatUsage;
  readonly onTraceViewChange: (view: TraceView) => void;
  readonly sessionId?: string;
  readonly traceView: TraceView;
}) {
  const { t } = useI18n();
  const [selectedId, setSelectedId] = useState<string>();
  const [open, setOpen] = useState(false);
  const traceCloseButton = useRef<HTMLButtonElement>(null);
  const restoreFocusId = useRef<string | undefined>(undefined);
  const sessions = useMemo(() => collectSubagentSessions(events), [events]);
  const usage = useChatUsage({
    events,
    historyComplete,
    initialUsage,
    sessionId,
  });

  useEffect(() => {
    if (!selectedId) {
      const taskId = restoreFocusId.current;
      if (!taskId) return undefined;
      const frame = requestAnimationFrame(() => {
        document
          .querySelector<HTMLButtonElement>(
            `[data-task-session="${CSS.escape(taskId)}"]`
          )
          ?.focus();
        restoreFocusId.current = undefined;
      });
      return () => {
        cancelAnimationFrame(frame);
      };
    }

    const frame = requestAnimationFrame(() =>
      traceCloseButton.current?.focus()
    );
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setSelectedId(undefined);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [selectedId]);

  const selected = sessions.find(
    (session) => session.childSessionId === selectedId
  );
  const statuses = useMemo(
    () =>
      new Map(
        sessions.map((session) => [
          session.childSessionId,
          getSubagentStatus([], session),
        ])
      ),
    [sessions]
  );
  const workingCount = [...statuses.values()].filter((status) =>
    ["starting", "working"].includes(status)
  ).length;
  const doneCount = sessions.length - workingCount;
  const openTask = (childSessionId: string) => {
    restoreFocusId.current = childSessionId;
    setSelectedId(childSessionId);
  };
  const closeTask = () => {
    setSelectedId(undefined);
  };
  const activity = (
    <ActivityCard
      doneCount={doneCount}
      eventsBySession={emptyEventsBySession}
      onSelect={openTask}
      onTraceViewChange={onTraceViewChange}
      sessions={sessions}
      statuses={statuses}
      traceView={traceView}
      usage={usage}
      workingCount={workingCount}
    />
  );

  return (
    <>
      <Button
        aria-label={t("Open activity panel")}
        className="absolute top-2 right-3 z-30"
        onClick={() => {
          setOpen(true);
        }}
        size="icon-sm"
        type="button"
        variant="ghost"
      >
        <ListTreeIcon />
      </Button>

      <Dialog
        onOpenChange={(isOpen) => {
          setOpen(isOpen);
          if (!isOpen) closeTask();
        }}
        open={open}
      >
        <DialogContent
          className="flex h-[85svh] w-full flex-col gap-0 overflow-hidden p-0"
          variant="responsive"
        >
          <DialogHeader className="sr-only">
            <DialogTitle>
              {selected
                ? t("{name}: {status}", {
                    name: selected.name,
                    status: t("Atividade"),
                  })
                : t("Agent activity")}
            </DialogTitle>
            <DialogDescription>
              {selected
                ? t("Full trace for the selected subagent")
                : t("Conversation views, sources, and live task statuses")}
            </DialogDescription>
          </DialogHeader>
          {selected ? (
            <TracePreview
              closeButtonRef={traceCloseButton}
              key={selected.childSessionId}
              onClose={closeTask}
              session={selected}
            />
          ) : (
            activity
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
