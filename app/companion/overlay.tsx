"use client";
import type { CompanionOverlayProps } from "@zoen/companion-ui";
import { Dialog, DialogContent, DialogTitle } from "@web/components/ui/dialog";

export function renderWebCompanionOverlay({
  children,
  title,
  onClose,
}: CompanionOverlayProps) {
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent
        showCloseButton={false}
        animated={false}
        className="fixed inset-0 flex h-dvh w-full max-w-none! translate-0 rounded-none bg-transparent p-0 ring-0"
        aria-describedby={undefined}
      >
        <DialogTitle className="sr-only">{title}</DialogTitle>
        {children}
      </DialogContent>
    </Dialog>
  );
}
