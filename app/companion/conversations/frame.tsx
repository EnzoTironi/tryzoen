"use client";
import { useLayoutEffect } from "react";
import { useDefaultLayout, usePanelRef } from "react-resizable-panels";
import type { ConversationLayoutProps } from "@zoen/companion-ui";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@web/components/ui/resizable";

export function BrowserConversationLayout({
  children,
  panel,
  open,
}: ConversationLayoutProps) {
  const sidebar = usePanelRef();
  const { defaultLayout, onLayoutChanged } = useDefaultLayout({
    id: "zoen-conversations-width",
    onlySaveAfterUserInteractions: true,
  });
  useLayoutEffect(() => {
    if (open) sidebar.current?.expand();
    else sidebar.current?.collapse();
  }, [open, sidebar]);
  return (
    <ResizablePanelGroup
      id="companion-conversations"
      defaultLayout={defaultLayout}
      onLayoutChanged={onLayoutChanged}
      className="min-w-0 flex-1"
    >
      <ResizablePanel
        id="conversation-library"
        panelRef={sidebar}
        collapsible
        collapsedSize={0}
        minSize={220}
        maxSize={400}
        defaultSize={0}
        className="flex h-full min-h-0 flex-col"
      >
        {panel}
      </ResizablePanel>
      <ResizableHandle
        aria-label="Resize conversations"
        aria-hidden={!open}
        disabled={!open}
        className={open ? "bg-neutral-200" : "pointer-events-none opacity-0"}
      />
      <ResizablePanel
        id="conversation-content"
        minSize={300}
        className="flex h-full min-h-0 flex-col"
      >
        {children}
      </ResizablePanel>
    </ResizablePanelGroup>
  );
}
